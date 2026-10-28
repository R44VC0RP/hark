import { MCP_PATH } from "@hark/contracts";
import { type Context, Hono, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./auth";
import { canonicalOrigin, isLegacyRequest } from "./lib/origins";
import { INTERNAL_AGENT_TOKEN } from "./middleware";
import { activitiesAgentRoute, activitiesSessionRoute } from "./routes/activities";
import { activityFeedAgentRoute, activityFeedRoute } from "./routes/activity-feed";
import { activityHooksRoute } from "./routes/activity-hooks";
import { agentOpenApiRoute } from "./routes/agent-openapi";
import { analyticsRoute } from "./routes/analytics";
import { apiTokensAgentRoute, apiTokensRoute } from "./routes/api-tokens";
import { appleAuthRoute } from "./routes/apple-auth";
import { appPassJwksRoute, appsAgentRoute, appsSessionRoute } from "./routes/apps";
import { billingAgentRoute, billingRoute } from "./routes/billing";
import { deviceAuthorizationRoute } from "./routes/device-authorization";
import { devicesAgentRoute, devicesRoute } from "./routes/devices";
import { docsTextRoute } from "./routes/docs";
import { eventsRoute } from "./routes/events";
import { hooksRoute } from "./routes/hooks";
import { inboxAgentRoute, inboxRoute } from "./routes/inbox";
import {
  agentRoute,
  interactionCredentialResponseRoute,
  interactionResponseRoute,
  liveActivityInteractionResponseRoute,
} from "./routes/interactions";
import { liveActivityRegistrationRoute } from "./routes/live-activity-registration";
import { createMcpRoute, MCP_MAX_BODY_BYTES } from "./routes/mcp";
import { oauthClientsRoute, oauthWellKnownRoute } from "./routes/oauth";
import {
  oncallAgentRoute,
  oncallSessionRoute,
  pageResponsesRoute,
  pagesAgentRoute,
  pagesSessionRoute,
} from "./routes/oncall";
import { servicesAgentRoute, servicesRoute } from "./routes/services";
import { teamInvitesRoute, teamsAgentRoute, teamsSessionRoute } from "./routes/teams";

export const app = new Hono();

/** Path segments that are themselves credentials: webhook tokens, invite and user codes. */
const SECRET_SEGMENT = /\/(hooks|team-invites|join|device-authorization\/requests)\/[^/]+/gi;
/** Bearer-shaped values (`whk_…`, `hark_…`) wherever they appear in a path. */
const SECRET_TOKEN = /(?:whk|hark)_[^/]*/gi;

/**
 * Redacts credentials from a request path before it is logged. Matching is by
 * pattern rather than route so non-canonical paths that 404 (`//hooks/…`,
 * `/HOOKS/…`, percent-encoded) are covered too.
 */
export function redactLogPath(path: string): string {
  const redact = (value: string) =>
    value.replace(SECRET_SEGMENT, "/$1/:redacted").replace(SECRET_TOKEN, ":redacted");
  const redacted = redact(path);
  let decoded = redacted;
  try {
    decoded = decodeURIComponent(redacted);
  } catch {
    // Malformed escapes are logged as-is; the raw patterns above already applied.
  }
  // Percent-encoded markers survive the raw patterns; drop the whole path then.
  return decoded !== redacted && redact(decoded) !== decoded ? ":redacted" : redacted;
}

/** Logs requests without query strings, with credentials in the path redacted. */
async function accessLog(c: Context, next: Next): Promise<void> {
  const startedAt = Date.now();
  await next();
  const path = redactLogPath(c.req.path);
  console.log(`${c.req.method} ${path} ${c.res.status} ${Date.now() - startedAt}ms`);
}

// Anti-framing matters most on /oauth/consent and /cli/authorize, which grant
// access in one click. Images may come from any https origin (avatars, app
// icons, OAuth client logos); prerendered pages carry inline style attributes.
app.use(
  "*",
  secureHeaders({
    xFrameOptions: "DENY",
    referrerPolicy: "no-referrer",
    // Discovery documents, MCP and public images are read cross-origin.
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      imgSrc: ["'self'", "https:", "data:", "blob:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      usb: [],
      payment: [],
    },
  }),
);

/**
 * Earlier domains (LEGACY_APP_URLS) keep answering everything machines use:
 * the API, webhooks, MCP, discovery documents and files such as push avatars
 * (the iPhone fetches those without following redirects). Browser page loads
 * move to APP_URL with the same path, so old links land on the new domain.
 */
const LEGACY_PASSTHROUGH = ["/api/", "/hooks/", "/mcp", "/.well-known/", "/oss"];
/**
 * Browser steps of OAuth sign-in that set the state cookie. On a legacy host
 * the cookie would land on that host while the provider calls back to
 * APP_URL, so the sign-in fails with a state mismatch (the App Store app
 * before 1.3 starts Google sign-in on hark.ryan.ceo). These move to APP_URL
 * first, with a temporary redirect, so the cookie and callback share a host.
 */
const LEGACY_OAUTH_BROWSER_STEPS = ["/api/auth/expo-authorization-proxy"];
app.use("*", async (c, next) => {
  if (
    (c.req.method === "GET" || c.req.method === "HEAD") &&
    isLegacyRequest(c.req.url) &&
    LEGACY_OAUTH_BROWSER_STEPS.includes(c.req.path)
  ) {
    const url = new URL(c.req.url);
    return c.redirect(`${canonicalOrigin()}${url.pathname}${url.search}`, 302);
  }
  if (
    (c.req.method === "GET" || c.req.method === "HEAD") &&
    isLegacyRequest(c.req.url) &&
    !LEGACY_PASSTHROUGH.some((prefix) => c.req.path.startsWith(prefix)) &&
    !/\.[a-z0-9]+$/i.test(c.req.path)
  ) {
    const url = new URL(c.req.url);
    return c.redirect(`${canonicalOrigin()}${url.pathname}${url.search}`, 301);
  }
  return next();
});

// Bounds memory use for unauthenticated POST bodies; accepted payloads are far smaller.
// MCP tool calls wrap agent payloads in JSON-RPC, so /mcp gets more headroom.
const defaultBodyLimit = bodyLimit({ maxSize: 64 * 1024 });
const mcpBodyLimit = bodyLimit({ maxSize: MCP_MAX_BODY_BYTES });
app.use("*", (c, next) => (c.req.path === MCP_PATH ? mcpBodyLimit : defaultBodyLimit)(c, next));

if (process.env.NODE_ENV !== "test") {
  app.use("*", accessLog);
}

/**
 * API and webhook responses are private (webhook URLs, tokens, inbox items) and
 * must never be stored by a browser or the edge. Public discovery routes that
 * set their own Cache-Control keep it.
 */
async function noStoreByDefault(c: Context, next: Next): Promise<void> {
  await next();
  if (c.res.headers.has("Cache-Control")) return;
  try {
    c.res.headers.set("Cache-Control", "no-store");
  } catch {
    // Responses passed through from fetch have immutable headers; copy them.
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set("Cache-Control", "no-store");
  }
}
app.use("/api/*", noStoreByDefault);
app.use("/hooks/*", noStoreByDefault);

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/oss", (c) => c.redirect("https://github.com/R44VC0RP/hark/"));

// Mounted before the static handler in index.ts so the generated markdown wins
// over anything with the same name in dist/client.
app.route("/", docsTextRoute);
app.route("/", appPassJwksRoute);

// The Expo plugin's proxy sets a signed OAuth state cookie from the URL it is
// given and then redirects there. Only the social providers the app signs in
// with may be the target; anything else is an open redirect and login CSRF.
const EXPO_PROXY_ORIGINS = new Set(["https://accounts.google.com", "https://appleid.apple.com"]);
app.on(["GET", "POST"], "/api/auth/expo-authorization-proxy", async (c, next) => {
  // Exactly one value, so a second one cannot be what Better Auth reads.
  const targets = c.req.queries("authorizationURL") ?? [];
  let origin: string | null = null;
  try {
    origin = targets.length === 1 && targets[0] ? new URL(targets[0]).origin : null;
  } catch {
    origin = null;
  }
  if (!origin || !EXPO_PROXY_ORIGINS.has(origin)) {
    return c.json({ error: "Invalid authorizationURL" }, 400);
  }
  // The app opens this in a fresh auth session (Sec-Fetch-Site: none). A page on
  // another site linking here could still plant its own state cookie.
  const site = c.req.header("sec-fetch-site")?.toLowerCase();
  if (site === "cross-site" || site === "same-site") {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
});
// The signed consent request carries no nonce upstream, so back/refresh could
// approve it again and mint another authorization code. Each signature may
// decide one consent; it is reserved while in flight and released on failure.
const usedConsentSignatures = new Map<string, number>();
app.post("/api/auth/oauth2/consent", async (c, next) => {
  let oauthQuery: unknown;
  try {
    const request = c.req.raw.clone();
    const type = request.headers.get("content-type") ?? "";
    oauthQuery = type.includes("application/json")
      ? ((await request.json()) as { oauth_query?: unknown } | null)?.oauth_query
      : (await request.formData()).get("oauth_query");
  } catch {
    oauthQuery = undefined;
  }
  if (typeof oauthQuery !== "string") return next();
  const params = new URLSearchParams(oauthQuery);
  const sig = params.get("sig");
  if (!sig) return next();
  const now = Date.now();
  const expiresAt = Number(params.get("exp")) * 1000;
  if (usedConsentSignatures.has(sig)) {
    return c.json(
      { error: "invalid_request", error_description: "This request was already decided" },
      400,
    );
  }
  if (usedConsentSignatures.size >= 10_000) {
    for (const [key, expiry] of usedConsentSignatures) {
      if (expiry <= now) usedConsentSignatures.delete(key);
    }
  }
  usedConsentSignatures.set(sig, Number.isFinite(expiresAt) ? expiresAt : now + 10 * 60 * 1000);
  await next();
  if (!c.res.ok) usedConsentSignatures.delete(sig);
});
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
// OAuth discovery for the MCP server, and the server itself. Tool calls are
// dispatched through the agent routes below as the caller's grant token.
app.route("/", oauthWellKnownRoute);
app.route(
  "/",
  createMcpRoute(async (request, token) => app.fetch(request, { [INTERNAL_AGENT_TOKEN]: token })),
);
app.route("/api/oauth", oauthClientsRoute);

app.route("/api/services", servicesRoute);
app.route("/api/analytics", analyticsRoute);
app.route("/api/api-tokens", apiTokensRoute);
app.route("/api/apple-auth", appleAuthRoute);
app.route("/api/device-authorization", deviceAuthorizationRoute);
// The public discovery document must precede every token-guarded agent mount.
app.route("/api/agent", agentOpenApiRoute);
app.route("/api/agent/activities", activitiesAgentRoute);
app.route("/api/agent/activity-feed", activityFeedAgentRoute);
app.route("/api/agent/apps", appsAgentRoute);
app.route("/api/agent/billing", billingAgentRoute);
app.route("/api/agent/devices", devicesAgentRoute);
app.route("/api/agent/inbox", inboxAgentRoute);
app.route("/api/agent/oncall", oncallAgentRoute);
app.route("/api/agent/pages", pagesAgentRoute);
app.route("/api/agent/services", servicesAgentRoute);
app.route("/api/agent/teams", teamsAgentRoute);
app.route("/api/agent/tokens", apiTokensAgentRoute);
app.route("/api/agent", agentRoute);
app.route("/api/activities", activitiesSessionRoute);
app.route("/api/apps", appsSessionRoute);
app.route("/api/activity-feed", activityFeedRoute);
app.route("/api/inbox", inboxRoute);
app.route("/api/interactions", interactionResponseRoute);
app.route("/api/interaction-responses", interactionCredentialResponseRoute);
app.route("/api/live-activity-interactions", liveActivityInteractionResponseRoute);
app.route("/api/live-activity", liveActivityRegistrationRoute);
app.route("/api/billing", billingRoute);
app.route("/api/teams", teamsSessionRoute);
app.route("/api/team-invites", teamInvitesRoute);
app.route("/api/oncall", oncallSessionRoute);
app.route("/api/pages", pagesSessionRoute);
app.route("/api/page-responses", pageResponsesRoute);
app.route("/api/devices", devicesRoute);
app.route("/api/events", eventsRoute);
app.route("/hooks", activityHooksRoute);
app.route("/hooks", hooksRoute);

app.notFound((c) => {
  if (
    c.req.path.startsWith("/api") ||
    c.req.path.startsWith("/hooks") ||
    c.req.path.startsWith("/.well-known/oauth")
  ) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.text("Not found", 404);
});

app.onError((err, c) => {
  // Middleware rejections (for example the body-size limit) carry their own status.
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

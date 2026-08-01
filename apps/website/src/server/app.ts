import { type Context, Hono, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { auth } from "./auth";
import { activitiesAgentRoute, activitiesSessionRoute } from "./routes/activities";
import { activityFeedRoute } from "./routes/activity-feed";
import { activityHooksRoute } from "./routes/activity-hooks";
import { analyticsRoute } from "./routes/analytics";
import { apiTokensRoute } from "./routes/api-tokens";
import { appleAuthRoute } from "./routes/apple-auth";
import { billingRoute } from "./routes/billing";
import { deviceAuthorizationRoute } from "./routes/device-authorization";
import { devicesRoute } from "./routes/devices";
import { docsTextRoute } from "./routes/docs";
import { eventsRoute } from "./routes/events";
import { hooksRoute } from "./routes/hooks";
import {
  agentRoute,
  interactionCredentialResponseRoute,
  interactionResponseRoute,
  liveActivityInteractionResponseRoute,
} from "./routes/interactions";
import { liveActivityRegistrationRoute } from "./routes/live-activity-registration";
import { servicesRoute } from "./routes/services";

export const app = new Hono();

/**
 * Logs requests without query strings and redacts webhook paths: `/hooks/:token`
 * embeds a plaintext credential that must never reach a log sink.
 */
async function accessLog(c: Context, next: Next): Promise<void> {
  const startedAt = Date.now();
  await next();
  const path = c.req.path.startsWith("/hooks/") ? "/hooks/:token" : c.req.path;
  console.log(`${c.req.method} ${path} ${c.res.status} ${Date.now() - startedAt}ms`);
}

// Bounds memory use for unauthenticated POST bodies; accepted payloads are far smaller.
app.use("*", bodyLimit({ maxSize: 64 * 1024 }));

if (process.env.NODE_ENV !== "test") {
  app.use("*", accessLog);
}

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/oss", (c) => c.redirect("https://github.com/R44VC0RP/hark/"));

// Mounted before the static handler in index.ts so the generated markdown wins
// over anything with the same name in dist/client.
app.route("/", docsTextRoute);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/services", servicesRoute);
app.route("/api/analytics", analyticsRoute);
app.route("/api/api-tokens", apiTokensRoute);
app.route("/api/apple-auth", appleAuthRoute);
app.route("/api/device-authorization", deviceAuthorizationRoute);
app.route("/api/agent/activities", activitiesAgentRoute);
app.route("/api/agent", agentRoute);
app.route("/api/activities", activitiesSessionRoute);
app.route("/api/activity-feed", activityFeedRoute);
app.route("/api/interactions", interactionResponseRoute);
app.route("/api/interaction-responses", interactionCredentialResponseRoute);
app.route("/api/live-activity-interactions", liveActivityInteractionResponseRoute);
app.route("/api/live-activity", liveActivityRegistrationRoute);
app.route("/api/billing", billingRoute);
app.route("/api/devices", devicesRoute);
app.route("/api/events", eventsRoute);
app.route("/hooks", activityHooksRoute);
app.route("/hooks", hooksRoute);

app.notFound((c) => {
  if (c.req.path.startsWith("/api") || c.req.path.startsWith("/hooks")) {
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

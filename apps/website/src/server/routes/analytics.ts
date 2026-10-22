import { type ClientAnalyticsEventName, clientAnalyticsEventSchema } from "@hark/contracts";
import { Hono } from "hono";
import { auth } from "../auth";
import { env } from "../env";
import { track, trackUserActive } from "../lib/analytics";
import { requestKey } from "./device-authorization";

const RATE_WINDOW_MS = 60_000;
/** Per installation / browser (`anonymousId`, client-chosen). */
const ANONYMOUS_ID_LIMIT = 120;
/** Per trusted client IP. */
const CLIENT_IP_LIMIT = 60;
/** Across every caller: the honest ceiling when ids and IPs can be rotated. */
const GLOBAL_LIMIT = 2000;
const rates = new Map<string, { startedAt: number; count: number }>();

/**
 * iOS events the app sends before anyone has signed in (launch, the sign-in
 * screen, the start of sign-in). Every other iOS event needs a session.
 */
const IOS_PRE_AUTH_EVENTS = new Set<ClientAnalyticsEventName>([
  "app_open",
  "screen_view",
  "auth_started",
]);

function rateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const current = rates.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    if (!current && rates.size >= 10_000) {
      for (const [candidate, bucket] of rates) {
        if (now - bucket.startedAt >= RATE_WINDOW_MS) rates.delete(candidate);
      }
      // Still full of live buckets: refuse new keys rather than resetting everyone.
      if (rates.size >= 10_000) return true;
    }
    rates.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

/** A browser request from the app's own pages. */
function sameOrigin(header: (name: string) => string | undefined): boolean {
  const origin = header("origin");
  if (origin) return origin === new URL(env.APP_URL).origin;
  return header("sec-fetch-site") === "same-origin";
}

export const analyticsRoute = new Hono().post("/events", async (c) => {
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(env.APP_URL).origin) {
    return c.json({ error: "Cross-origin analytics are not accepted" }, 403);
  }

  const parsed = clientAnalyticsEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid analytics event", issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;
  if (input.surface === "web" && !sameOrigin((name) => c.req.header(name))) {
    return c.json({ error: "Web analytics must come from the Hark site" }, 403);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  if (input.surface === "ios" && !session && !IOS_PRE_AUTH_EVENTS.has(input.name)) {
    return c.json({ error: "Sign in to send this event" }, 401);
  }

  // Over budget, the event is dropped quietly: clients never retry analytics.
  const clientIp = requestKey(c);
  if (
    (clientIp !== null && rateLimited(`ip:${clientIp}`, CLIENT_IP_LIMIT)) ||
    rateLimited(`anon:${input.anonymousId}`, ANONYMOUS_ID_LIMIT) ||
    rateLimited("global", GLOBAL_LIMIT)
  ) {
    return c.json({ ok: true, accepted: false }, 202);
  }

  const accepted = track({
    name: input.name,
    clientEventId: input.eventId,
    anonymousId: input.anonymousId,
    sessionId: input.sessionId,
    surface: input.surface,
    userId: session?.user.id ?? null,
    outcome: input.outcome,
    metadata: {
      ...(input.path ? { path: input.path } : {}),
      ...input.properties,
    },
  });
  if (session?.user.id) trackUserActive(session.user.id);
  return c.json({ ok: true, accepted });
});

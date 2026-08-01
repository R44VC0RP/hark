import { clientAnalyticsEventSchema } from "@hark/contracts";
import { Hono } from "hono";
import { auth } from "../auth";
import { env } from "../env";
import { track, trackUserActive } from "../lib/analytics";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const rates = new Map<string, { startedAt: number; count: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const current = rates.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    if (rates.size > 10_000) rates.clear();
    rates.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT;
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
  if (rateLimited(parsed.data.anonymousId)) {
    return c.json({ error: "Analytics rate limit exceeded" }, 429);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  const input = parsed.data;
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

import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

let db: typeof import("../db")["db"];
let sqlite: typeof import("../db")["sqlite"];
let schema: typeof import("../db/schema");
let analytics: typeof import("./analytics");

beforeAll(async () => {
  ({ db, sqlite } = await import("../db"));
  schema = await import("../db/schema");
  analytics = await import("./analytics");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
});

beforeEach(async () => {
  analytics.resetAnalyticsCaches();
  await db.delete(schema.analyticsEvent);
  await db.delete(schema.analyticsDaily);
  await db.delete(schema.analyticsUserDay);
});

describe("track", () => {
  it("writes one event row plus count and value rollups", async () => {
    analytics.track({
      name: "webhook_delivered",
      userId: "user_1",
      serviceId: "svc_1",
      plan: "free",
      outcome: "accepted",
      value: 3,
      metadata: { targets: 3 },
    });

    const rows = await db.select().from(schema.analyticsEvent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "webhook_delivered",
      userId: "user_1",
      serviceId: "svc_1",
      plan: "free",
      outcome: "accepted",
      value: 3,
      metadata: '{"targets":3}',
    });

    const day = analytics.analyticsDay();
    const rollups = await db.select().from(schema.analyticsDaily);
    expect(rollups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ day, metric: "webhook_delivered", value: 1 }),
        expect.objectContaining({ day, metric: "webhook_delivered:value", value: 3 }),
      ]),
    );
  });

  it("upserts rollups idempotently so repeated events only add to the same row", async () => {
    for (let index = 0; index < 5; index += 1) {
      analytics.track({ name: "webhook_received", userId: "user_1", serviceId: "svc_1" });
    }

    const day = analytics.analyticsDay();
    const rollups = await db
      .select()
      .from(schema.analyticsDaily)
      .where(
        and(
          eq(schema.analyticsDaily.day, day),
          eq(schema.analyticsDaily.metric, "webhook_received"),
        ),
      );
    expect(rollups).toHaveLength(1);
    expect(rollups[0]?.value).toBe(5);
  });

  it("deduplicates retried client events before incrementing rollups", async () => {
    const input = {
      name: "page_view" as const,
      clientEventId: "event_retry_123456",
      anonymousId: "visitor_1234567890",
      sessionId: "session_1234567890",
      surface: "web" as const,
      metadata: { path: "/pricing" },
    };
    expect(analytics.track(input)).toBe(true);
    expect(analytics.track(input)).toBe(false);

    expect(await db.select().from(schema.analyticsEvent)).toHaveLength(1);
    const rollups = await db
      .select()
      .from(schema.analyticsDaily)
      .where(eq(schema.analyticsDaily.metric, "page_view"));
    expect(rollups[0]?.value).toBe(1);
  });

  it("caps metadata size and keeps only primitive keys", async () => {
    analytics.track({
      name: "webhook_failed",
      userId: "user_1",
      metadata: { note: "y".repeat(5_000), skipped: null, count: 2 },
    });
    const oversized: Record<string, string> = {};
    for (let index = 0; index < 8; index += 1) {
      oversized[`key_number_${index}`] = "z".repeat(64);
    }
    analytics.track({ name: "webhook_failed", userId: "user_1", metadata: oversized });
    analytics.track({ name: "webhook_failed", userId: "user_1", metadata: { skipped: null } });

    const rows = await db.select().from(schema.analyticsEvent);
    const first = JSON.parse(rows[0]?.metadata ?? "{}") as Record<string, unknown>;
    expect(first.count).toBe(2);
    expect(first.skipped).toBeUndefined();
    expect(String(first.note)).toHaveLength(64);
    expect(rows[1]?.metadata).toBeNull();
    expect(rows[2]?.metadata).toBeNull();
  });

  it("never throws when the analytics tables are unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sqlite.exec("ALTER TABLE analytics_event RENAME TO analytics_event_hidden");
    try {
      expect(() => analytics.track({ name: "webhook_received", userId: "user_1" })).not.toThrow();
      expect(() => analytics.trackUserActive("user_1")).not.toThrow();
      expect(() => analytics.pruneAnalytics()).not.toThrow();
    } finally {
      sqlite.exec("ALTER TABLE analytics_event_hidden RENAME TO analytics_event");
      warn.mockRestore();
    }
  });
});

describe("trackUserActive", () => {
  it("records one row per user per UTC day", async () => {
    analytics.trackUserActive("user_1");
    analytics.trackUserActive("user_1");
    analytics.resetAnalyticsCaches();
    analytics.trackUserActive("user_1");
    analytics.trackUserActive("user_2");

    const days = await db.select().from(schema.analyticsUserDay);
    expect(days).toHaveLength(2);
    expect(days.map((row) => row.userId).sort()).toEqual(["user_1", "user_2"]);

    const pings = await db
      .select()
      .from(schema.analyticsEvent)
      .where(eq(schema.analyticsEvent.name, "user_active"));
    expect(pings).toHaveLength(2);

    const [rollup] = await db
      .select()
      .from(schema.analyticsDaily)
      .where(eq(schema.analyticsDaily.metric, "user_active"));
    expect(rollup?.value).toBe(2);
  });

  it("ignores anonymous requests", async () => {
    analytics.trackUserActive(null);
    analytics.trackUserActive(undefined);
    expect(await db.select().from(schema.analyticsUserDay)).toHaveLength(0);
  });
});

describe("pruneAnalytics", () => {
  it("deletes events past the retention window and keeps rollups", async () => {
    const stale = new Date(
      Date.now() - (analytics.ANALYTICS_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    await db.insert(schema.analyticsEvent).values([
      { id: "anl_old", name: "webhook_received", value: 0, createdAt: stale },
      { id: "anl_new", name: "webhook_received", value: 0, createdAt: new Date() },
    ]);
    await db.insert(schema.analyticsUserDay).values([
      { userId: "user_old", day: "2020-01-01", createdAt: stale },
      { userId: "user_new", day: analytics.analyticsDay(), createdAt: new Date() },
    ]);
    await db
      .insert(schema.analyticsDaily)
      .values({ day: "2020-01-01", metric: "webhook_received", value: 7, updatedAt: stale });

    analytics.pruneAnalytics();

    const events = await db.select().from(schema.analyticsEvent);
    expect(events.map((row) => row.id)).toEqual(["anl_new"]);
    const userDays = await db.select().from(schema.analyticsUserDay);
    expect(userDays.map((row) => row.userId)).toEqual(["user_old", "user_new"]);
    expect(await db.select().from(schema.analyticsDaily)).toHaveLength(1);
  });
});

describe("failureBucket", () => {
  it("maps raw reasons onto coarse buckets", () => {
    expect(analytics.failureBucket("DeviceNotRegistered")).toBe("device_unregistered");
    expect(analytics.failureBucket("BadDeviceToken")).toBe("invalid_token");
    expect(analytics.failureBucket("MissingUpdateToken")).toBe("missing_token");
    expect(analytics.failureBucket("TooManyRequests")).toBe("rate_limited");
    expect(analytics.failureBucket("socket timeout")).toBe("network");
    expect(analytics.failureBucket(undefined)).toBe("unknown");
    expect(analytics.failureBucket("something odd")).toBe("other");
  });
});

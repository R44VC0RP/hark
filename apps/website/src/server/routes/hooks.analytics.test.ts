import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: "free",
    priceMonthly: 8,
    features: { deviceRouting: false },
    limits: {
      devices: 1,
      notificationsPerMonth: 10_000,
      servicePerMinute: 60,
      accountPerMinute: 300,
    },
    usage: { notificationsRemaining: 10_000 },
  }),
  checkNotificationAllowance: async () => true,
  trackNotification: async () => undefined,
  hasAutumn: () => false,
  clearBillingCache: () => undefined,
  createCheckout: async () => "https://example.com/checkout",
  createBillingPortal: async () => "https://example.com/portal",
}));

vi.mock("expo-server-sdk", () => {
  class Expo {
    // biome-ignore lint/complexity/noUselessConstructor: mock parity with the SDK
    constructor(_options?: unknown) {}
    chunkPushNotifications(messages: Array<Record<string, unknown>>) {
      return [messages];
    }
    async sendPushNotificationsAsync(chunk: Array<Record<string, unknown>>) {
      return chunk.map(() => ({ status: "ok", id: "ticket" }));
    }
  }
  return { Expo, default: Expo };
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let sqlite: typeof import("../db")["sqlite"];
let schema: typeof import("../db/schema");
let analytics: typeof import("../lib/analytics");

const TOKEN = "whk_analytics-token-abcdefghijklmnop";
const SECRET_BODY = "deploy failed for customer alice@example.com";

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db, sqlite } = await import("../db"));
  schema = await import("../db/schema");
  analytics = await import("../lib/analytics");
  const { hashWebhookToken } = await import("../lib/token");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values({
    id: "user_analytics",
    name: "Analytics User",
    email: "analytics@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.service).values({
    id: "svc_analytics",
    userId: "user_analytics",
    title: "Deploys",
    tokenHash: hashWebhookToken(TOKEN),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.device).values({
    id: "dev_analytics",
    userId: "user_analytics",
    expoPushToken: "ExponentPushToken[analytics]",
    platform: "ios",
    active: true,
    createdAt: now,
    lastSeenAt: now,
  });
});

beforeEach(async () => {
  analytics.resetAnalyticsCaches();
  await db.delete(schema.analyticsEvent);
  await db.delete(schema.analyticsDaily);
  await db.delete(schema.analyticsUserDay);
  await db.delete(schema.event);
});

async function postWebhook(body: unknown) {
  return app.request(`/hooks/${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("webhook analytics", () => {
  it("records receipt, delivery and notification events for a delivered webhook", async () => {
    const res = await postWebhook({ body: SECRET_BODY, title: "Deploy 42" });
    expect(res.status).toBe(200);

    const rows = await db.select().from(schema.analyticsEvent);
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect([...byName.keys()].sort()).toEqual([
      "notification_sent",
      "webhook_delivered",
      "webhook_received",
    ]);
    expect(byName.get("webhook_received")).toMatchObject({
      userId: "user_analytics",
      serviceId: "svc_analytics",
      plan: "free",
    });
    expect(byName.get("webhook_delivered")).toMatchObject({
      outcome: "accepted",
      value: 1,
      metadata: '{"targets":1}',
    });
    expect(byName.get("notification_sent")).toMatchObject({ outcome: "webhook", value: 1 });

    const day = analytics.analyticsDay();
    const rollups = await db.select().from(schema.analyticsDaily);
    expect(rollups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ day, metric: "webhook_received", value: 1 }),
        expect.objectContaining({ day, metric: "notification_sent:value", value: 1 }),
      ]),
    );
  });

  it("stores no notification content, tokens or emails", async () => {
    await postWebhook({ body: SECRET_BODY, title: "Deploy 42", url: "https://example.com/build" });

    const rows = await db.select().from(schema.analyticsEvent);
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows);
    for (const secret of [
      SECRET_BODY,
      "Deploy 42",
      "https://example.com/build",
      TOKEN,
      "ExponentPushToken[analytics]",
      "analytics@example.com",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // Only the documented columns are ever populated.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "anonymousId",
        "clientEventId",
        "createdAt",
        "deviceId",
        "id",
        "metadata",
        "name",
        "outcome",
        "plan",
        "serviceId",
        "sessionId",
        "surface",
        "userId",
        "value",
      ]);
    }
  });

  it("delivers the webhook even when analytics writes fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sqlite.exec("ALTER TABLE analytics_event RENAME TO analytics_event_broken");
    try {
      const res = await postWebhook({ body: SECRET_BODY });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, delivered: 1 });
      const [delivered] = await db
        .select()
        .from(schema.event)
        .where(eq(schema.event.serviceId, "svc_analytics"));
      expect(delivered?.status).toBe("accepted");
    } finally {
      sqlite.exec("ALTER TABLE analytics_event_broken RENAME TO analytics_event");
      warn.mockRestore();
    }
  });
});

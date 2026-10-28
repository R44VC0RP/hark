import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () => ({
        user: {
          id: "welcome_user",
          name: "Welcome User",
          email: "welcome@example.com",
          image: null,
        },
      }),
    },
  },
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: "pro",
    priceMonthly: 8,
    features: { deviceRouting: true },
    limits: {
      devices: null,
      notificationsPerMonth: 100_000,
      servicePerMinute: 300,
      accountPerMinute: 1500,
    },
    usage: { notificationsRemaining: 100_000 },
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
      sent.push(...chunk);
      return chunk.map(() => ({ status: "ok", id: "ticket" }));
    }
  }
  return { Expo, default: Expo };
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values({
    id: "welcome_user",
    name: "Welcome User",
    email: "welcome@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.user).values({
    id: "other_user",
    name: "Other User",
    email: "other@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
});

beforeEach(async () => {
  vi.useFakeTimers();
  sent.length = 0;
  await db.delete(schema.device);
  await db
    .update(schema.user)
    .set({ welcomeNotificationSentAt: null })
    .where(eq(schema.user.id, "welcome_user"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function register(expoPushToken: string, apnsToken?: string) {
  return app.request("/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expoPushToken,
      platform: "ios",
      deviceName: "iPhone",
      ...(apnsToken ? { apnsToken } : {}),
    }),
  });
}

describe("POST /api/devices onboarding", () => {
  it("sends the welcome once for the account's first registered phone", async () => {
    const firstRequest = register("ExponentPushToken[welcome-a]");
    await vi.advanceTimersByTimeAsync(4_000);
    const first = await firstRequest;
    expect(first.status).toBe(201);
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[welcome-a]",
      title: "Ryan",
      body: "hey! my name is ryan and I made hark!",
      data: {
        sourceName: "Ryan",
        url: "https://x.com/ryanvogel",
      },
    });
    expect(sent[1]).toMatchObject({
      body: "easily send notifications via a webhook",
      data: { url: "https://hark.fyi" },
    });
    expect(sent[2]).toMatchObject({
      body: "get started here (click me)",
      data: { url: "https://hark.fyi" },
    });

    const refresh = await register("ExponentPushToken[welcome-a]");
    const secondPhone = await register("ExponentPushToken[welcome-b]");
    expect(refresh.status).toBe(201);
    expect(secondPhone.status).toBe(201);
    expect(sent).toHaveLength(3);

    const [account] = await db.select().from(schema.user);
    expect(account?.welcomeNotificationSentAt).toBeInstanceOf(Date);
  });
});

describe("POST /api/devices owner change", () => {
  const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    // Skip the welcome pushes; these tests are about ownership only.
    await db
      .update(schema.user)
      .set({ welcomeNotificationSentAt: new Date() })
      .where(eq(schema.user.id, "welcome_user"));
  });

  async function seedOtherAccountDevice(values: { apnsToken: string | null; active: boolean }) {
    await db.insert(schema.device).values({
      id: "dev_other",
      userId: "other_user",
      expoPushToken: "ExponentPushToken[shared]",
      apnsToken: values.apnsToken,
      active: values.active,
      createdAt: longAgo,
      lastSeenAt: longAgo,
    });
  }

  async function owner() {
    const [row] = await db
      .select({ userId: schema.device.userId })
      .from(schema.device)
      .where(eq(schema.device.expoPushToken, "ExponentPushToken[shared]"));
    return row?.userId;
  }

  it("moves the device when the same phone signs into another account", async () => {
    await seedOtherAccountDevice({ apnsToken: "apns-shared", active: true });
    const response = await register("ExponentPushToken[shared]", "apns-shared");
    expect(response.status).toBe(201);
    expect(await owner()).toBe("welcome_user");
  });

  it("rejects a stale token claimed without the phone's APNs token", async () => {
    await seedOtherAccountDevice({ apnsToken: "apns-shared", active: false });
    for (const apnsToken of [undefined, "apns-guess"]) {
      const response = await register("ExponentPushToken[shared]", apnsToken);
      expect(response.status).toBe(409);
      const body = await response.text();
      expect(body).not.toContain("other_user");
      expect(body).not.toContain("other@example.com");
    }
    expect(await owner()).toBe("other_user");
  });

  it("rejects an idle token without an APNs token until Expo reports it unregistered", async () => {
    await seedOtherAccountDevice({ apnsToken: null, active: true });
    expect((await register("ExponentPushToken[shared]")).status).toBe(409);
    expect(await owner()).toBe("other_user");

    await db.update(schema.device).set({ active: false }).where(eq(schema.device.id, "dev_other"));
    expect((await register("ExponentPushToken[shared]")).status).toBe(201);
    expect(await owner()).toBe("welcome_user");
  });
});

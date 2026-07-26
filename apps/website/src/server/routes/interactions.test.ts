import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "user_1" as string | null }));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const tracked = vi.hoisted(() => [] as string[]);
const billingState = vi.hoisted(() => ({
  pro: true,
  servicePerMinute: 10_000,
  accountPerMinute: 10_000,
  allowance: true,
  acceptPush: true,
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: billingState.pro ? "pro" : "free",
    priceMonthly: 8,
    features: { deviceRouting: billingState.pro },
    limits: {
      devices: billingState.pro ? null : 1,
      notificationsPerMonth: billingState.pro ? 100_000 : 10_000,
      servicePerMinute: billingState.servicePerMinute,
      accountPerMinute: billingState.accountPerMinute,
    },
    usage: { notificationsRemaining: billingState.allowance ? 100 : 0 },
  }),
  checkNotificationAllowance: async () => billingState.allowance,
  trackNotification: async (_userId: string, eventId: string) => tracked.push(eventId),
  hasAutumn: () => false,
  clearBillingCache: () => undefined,
  createCheckout: async () => "https://example.com/checkout",
  createBillingPortal: async () => "https://example.com/portal",
}));

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: "Test User",
                email: "test@example.com",
                image: null,
              },
            }
          : null,
    },
  },
}));

vi.mock("expo-server-sdk", () => {
  class Expo {
    chunkPushNotifications(messages: Array<Record<string, unknown>>) {
      return [messages];
    }
    async sendPushNotificationsAsync(messages: Array<Record<string, unknown>>) {
      sent.push(...messages);
      return messages.map(() =>
        billingState.acceptPush
          ? { status: "ok", id: "ticket" }
          : { status: "error", message: "rejected" },
      );
    }
  }
  return { Expo, default: Expo };
});

afterEach(() => {
  authState.userId = "user_1";
  billingState.pro = true;
  billingState.servicePerMinute = 10_000;
  billingState.accountPerMinute = 10_000;
  billingState.allowance = true;
  billingState.acceptPush = true;
  tracked.length = 0;
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let hashApiToken: typeof import("../lib/token")["hashApiToken"];

const SECRET = `hark_${"a".repeat(43)}`;
const READ_SECRET = `hark_${"b".repeat(43)}`;
const OTHER_SECRET = `hark_${"c".repeat(43)}`;
const EXPIRED_SECRET = `hark_${"d".repeat(43)}`;

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ hashApiToken } = await import("../lib/token"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user_2",
      name: "Other User",
      email: "other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.device).values([
    {
      id: "dev_1",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[a]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    },
    {
      id: "dev_2",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[b]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    },
    {
      id: "dev_foreign",
      userId: "user_2",
      expoPushToken: "ExponentPushToken[foreign]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    },
  ]);
  await db.insert(schema.apiToken).values([
    {
      id: "tok_full",
      userId: "user_1",
      name: "Full",
      tokenHash: hashApiToken(SECRET),
      prefix: SECRET.slice(0, 13),
      scopes: ["notifications:send", "interactions:create", "interactions:read"],
      createdAt: now,
    },
    {
      id: "tok_read",
      userId: "user_1",
      name: "Read",
      tokenHash: hashApiToken(READ_SECRET),
      prefix: READ_SECRET.slice(0, 13),
      scopes: ["interactions:read"],
      createdAt: now,
    },
    {
      id: "tok_other",
      userId: "user_1",
      name: "Other",
      tokenHash: hashApiToken(OTHER_SECRET),
      prefix: OTHER_SECRET.slice(0, 13),
      scopes: ["interactions:read"],
      createdAt: now,
    },
    {
      id: "tok_expired",
      userId: "user_1",
      name: "Expired",
      tokenHash: hashApiToken(EXPIRED_SECRET),
      prefix: EXPIRED_SECRET.slice(0, 13),
      scopes: ["interactions:read"],
      expiresAt: new Date(now.getTime() - 1000),
      createdAt: now,
    },
  ]);
});

function agent(path: string, token = SECRET, init?: RequestInit) {
  return app.request(`/api/agent${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

async function createNotification(body: Record<string, unknown>, key?: string, token = SECRET) {
  return agent("/notifications", token, {
    method: "POST",
    headers: key ? { "Idempotency-Key": key } : undefined,
    body: JSON.stringify(body),
  });
}

async function createInteraction(body: Record<string, unknown>, key?: string) {
  return agent("/interactions", SECRET, {
    method: "POST",
    headers: key ? { "Idempotency-Key": key } : undefined,
    body: JSON.stringify(body),
  });
}

describe("agent token authentication", () => {
  it("rejects missing, expired, and insufficiently scoped tokens", async () => {
    expect((await app.request("/api/agent/auth/status")).status).toBe(401);
    expect((await agent("/auth/status", EXPIRED_SECRET)).status).toBe(401);
    const scoped = await agent("/interactions", READ_SECRET, {
      method: "POST",
      body: JSON.stringify({ title: "T", prompt: "P", kind: "approval" }),
    });
    expect(scoped.status).toBe(403);
    expect(await scoped.json()).toMatchObject({ error: "Insufficient scope" });
  });

  it("accepts a case-insensitive Bearer scheme while keeping the token exact", async () => {
    const lowerScheme = await app.request("/api/agent/auth/status", {
      headers: { authorization: `bearer ${SECRET}` },
    });
    expect(lowerScheme.status).toBe(200);
    const changedToken = await app.request("/api/agent/auth/status", {
      headers: { authorization: `Bearer ${SECRET.toUpperCase()}` },
    });
    expect(changedToken.status).toBe(401);
  });

  it("creates session-managed secrets once and persists only the hash", async () => {
    const created = await app.request("/api/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dashboard", scopes: ["devices:read"] }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { secret: string; token: { id: string } };
    expect(body.secret).toMatch(/^hark_/);

    const { eq } = await import("drizzle-orm");
    const [stored] = await db
      .select()
      .from(schema.apiToken)
      .where(eq(schema.apiToken.id, body.token.id));
    expect(stored?.tokenHash).toBe(hashApiToken(body.secret));
    expect(JSON.stringify(stored)).not.toContain(body.secret);

    const listed = await app.request("/api/api-tokens");
    expect(JSON.stringify(await listed.json())).not.toContain(body.secret);
  });

  it("caps active API tokens at 25 per user", async () => {
    const now = new Date();
    await db.insert(schema.apiToken).values(
      Array.from({ length: 25 }, (_, index) => ({
        id: `tok_cap_${index}`,
        userId: "user_2",
        name: `Cap ${index}`,
        tokenHash: `cap_hash_${index}`,
        prefix: `hark_cap_${index}`,
        scopes: ["devices:read"],
        createdAt: now,
      })),
    );
    authState.userId = "user_2";
    const response = await app.request("/api/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "One too many", scopes: ["devices:read"] }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("25") });
  });

  it("updates token last-used timestamps at most once per minute", async () => {
    const recent = new Date(Date.now() - 10_000);
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.apiToken)
      .set({ lastUsedAt: recent })
      .where(eq(schema.apiToken.id, "tok_full"));
    expect((await agent("/auth/status")).status).toBe(200);
    const [token] = await db
      .select({ lastUsedAt: schema.apiToken.lastUsedAt })
      .from(schema.apiToken)
      .where(eq(schema.apiToken.id, "tok_full"));
    expect(token?.lastUsedAt?.getTime()).toBe(recent.getTime());
  });
});

describe("agent notifications", () => {
  it("sends a one-shot notification using the token name as the default title", async () => {
    sent.length = 0;
    const response = await createNotification({ body: "Tests passed" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      accepted: 2,
      notification: {
        title: "Full",
        body: "Tests passed",
        status: "accepted",
        accepted: 2,
      },
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      title: "Full",
      body: "Tests passed",
      data: {
        serviceId: "agent-tok_full",
        sourceId: "agent-tok_full",
        sourceName: "Full",
      },
    });
    expect(tracked).toHaveLength(1);
  });

  it("requires notification scope and validates the payload", async () => {
    expect((await createNotification({ body: "No" }, undefined, READ_SECRET)).status).toBe(403);
    const invalid = await createNotification({ body: "", response: { type: "approval" } });
    expect(invalid.status).toBe(400);
  });

  it("supports idempotency without sending the push twice", async () => {
    sent.length = 0;
    const payload = { body: "Build complete", title: "Mux" };
    const first = await createNotification(payload, "build-1");
    const firstBody = (await first.json()) as { notification: { id: string } };
    const replay = await createNotification(payload, "build-1");
    expect(await replay.json()).toMatchObject({
      idempotent: true,
      notification: { id: firstBody.notification.id },
    });
    expect(sent).toHaveLength(2);
    const conflict = await createNotification({ ...payload, body: "Build failed" }, "build-1");
    expect(conflict.status).toBe(409);
  });

  it("applies device routing rules and reports no accepted pushes", async () => {
    billingState.pro = false;
    sent.length = 0;
    const free = await createNotification({ body: "One device" });
    expect(await free.json()).toMatchObject({ accepted: 1 });
    expect(sent).toHaveLength(1);
    expect((await createNotification({ body: "Target", deviceIds: ["dev_2"] })).status).toBe(402);

    billingState.pro = true;
    sent.length = 0;
    billingState.acceptPush = false;
    const rejected = await createNotification({ body: "Rejected", deviceIds: ["dev_2"] });
    expect(await rejected.json()).toMatchObject({
      accepted: 0,
      message: "No notifications were accepted by Expo.",
      notification: { status: "failed" },
    });
    expect(tracked).toHaveLength(1);
  });

  it("enforces requester, account, and monthly limits", async () => {
    billingState.servicePerMinute = 0;
    const requester = await createNotification({ body: "Limited" });
    expect(requester.status).toBe(429);
    expect(requester.headers.get("Retry-After")).toBe("60");

    billingState.servicePerMinute = 10_000;
    billingState.accountPerMinute = 0;
    expect((await createNotification({ body: "Limited" })).status).toBe(429);

    billingState.accountPerMinute = 10_000;
    billingState.allowance = false;
    expect((await createNotification({ body: "Limited" })).status).toBe(429);
  });
});

describe("interactions", () => {
  it("cascades interactions if an account and its token rows are deleted", async () => {
    const now = new Date();
    await db.insert(schema.user).values({
      id: "user_delete_regression",
      name: "Delete Me",
      email: "delete-regression@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apiToken).values({
      id: "tok_delete_regression",
      userId: "user_delete_regression",
      name: "Delete Me",
      tokenHash: "delete_regression_hash",
      prefix: "hark_delete_",
      scopes: ["interactions:create"],
      createdAt: now,
    });
    await db.insert(schema.interaction).values({
      id: "int_delete_regression",
      userId: "user_delete_regression",
      requesterTokenId: "tok_delete_regression",
      title: "Delete Me",
      prompt: "Delete Me",
      kind: "approval",
      choices: ["approve", "deny"],
      actionDigest: "delete-regression",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.user).where(eq(schema.user.id, "user_delete_regression"));
    expect(
      await db
        .select()
        .from(schema.interaction)
        .where(eq(schema.interaction.id, "int_delete_regression")),
    ).toHaveLength(0);
  });

  it("creates an actionable notification with accepted-not-delivered semantics", async () => {
    sent.length = 0;
    const response = await createInteraction({
      title: "Release",
      prompt: "Deploy production?",
      kind: "approval",
      expiresInSeconds: 60,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      accepted: 2,
      interaction: { status: "pending" },
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      categoryId: "HARK_APPROVAL_V1",
      data: { actionDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(tracked).toHaveLength(1);
  });

  it("is idempotent per requester token and rejects changed payloads", async () => {
    sent.length = 0;
    const payload = { title: "Release", prompt: "Ship?", kind: "approval" };
    const first = await createInteraction(payload, "release-1");
    const firstBody = (await first.json()) as { interaction: { id: string } };
    const replay = await createInteraction(payload, "release-1");
    expect(await replay.json()).toMatchObject({
      idempotent: true,
      interaction: { id: firstBody.interaction.id },
    });
    expect(sent).toHaveLength(2);
    const conflict = await createInteraction({ ...payload, prompt: "Do not ship?" }, "release-1");
    expect(conflict.status).toBe(409);
  });

  it("returns 409 for concurrent idempotency inserts with different payloads", async () => {
    const [first, second] = await Promise.all([
      createInteraction({ title: "Release", prompt: "Ship A?", kind: "approval" }, "race-1"),
      createInteraction({ title: "Release", prompt: "Ship B?", kind: "approval" }, "race-1"),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
  });

  it("applies free device limits and reserves targeted routing for Pro", async () => {
    billingState.pro = false;
    sent.length = 0;
    const free = await createInteraction({ title: "Free", prompt: "One device", kind: "reply" });
    expect(await free.json()).toMatchObject({ accepted: 1 });
    expect(sent).toHaveLength(1);

    const targetedFree = await createInteraction({
      title: "Free",
      prompt: "Target device",
      kind: "reply",
      deviceIds: ["dev_2"],
    });
    expect(targetedFree.status).toBe(402);

    billingState.pro = true;
    sent.length = 0;
    const targetedPro = await createInteraction({
      title: "Pro",
      prompt: "Target device",
      kind: "reply",
      deviceIds: ["dev_2"],
    });
    expect(await targetedPro.json()).toMatchObject({ accepted: 1 });
    expect(sent[0]).toMatchObject({ to: "ExponentPushToken[b]" });
  });

  it("enforces requester, combined account, and monthly limits before creation", async () => {
    billingState.servicePerMinute = 0;
    const requesterLimited = await createInteraction({
      title: "Limited",
      prompt: "Requester",
      kind: "approval",
    });
    expect(requesterLimited.status).toBe(429);
    expect(requesterLimited.headers.get("Retry-After")).toBe("60");
    expect(await requesterLimited.json()).toMatchObject({ error: "Requester rate limit exceeded" });

    billingState.servicePerMinute = 10_000;
    billingState.accountPerMinute = 0;
    const accountLimited = await createInteraction({
      title: "Limited",
      prompt: "Account",
      kind: "approval",
    });
    expect(accountLimited.status).toBe(429);
    expect(await accountLimited.json()).toMatchObject({ error: "Account rate limit exceeded" });

    billingState.accountPerMinute = 10_000;
    billingState.allowance = false;
    const monthlyLimited = await createInteraction({
      title: "Limited",
      prompt: "Monthly",
      kind: "approval",
    });
    expect(monthlyLimited.status).toBe(429);
    expect(await monthlyLimited.json()).toMatchObject({
      error: "Monthly notification limit reached",
    });
  });

  it("counts webhook events toward the interaction account rate limit", async () => {
    const now = new Date();
    await db.insert(schema.service).values({
      id: "svc_interaction_rate",
      userId: "user_1",
      title: "Rate source",
      tokenHash: "rate_source_hash",
      createdAt: now,
      updatedAt: now,
    });
    const { and, count, eq, gte } = await import("drizzle-orm");
    const [recentInteractions] = await db
      .select({ value: count() })
      .from(schema.interaction)
      .where(
        and(
          eq(schema.interaction.userId, "user_1"),
          gte(schema.interaction.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    await db.insert(schema.event).values({
      id: "evt_interaction_rate",
      serviceId: "svc_interaction_rate",
      title: "Rate",
      body: "Count me",
      status: "accepted",
      createdAt: now,
    });
    billingState.accountPerMinute = (recentInteractions?.value ?? 0) + 1;
    const response = await createInteraction({
      title: "Limited",
      prompt: "Combined usage",
      kind: "approval",
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "Account rate limit exceeded" });
  });

  it("tracks monthly usage once only when at least one push is accepted", async () => {
    const accepted = await createInteraction({ title: "Track", prompt: "Accepted", kind: "reply" });
    expect(accepted.status).toBe(201);
    expect(tracked).toHaveLength(1);

    tracked.length = 0;
    billingState.acceptPush = false;
    const rejected = await createInteraction({ title: "Track", prompt: "Rejected", kind: "reply" });
    expect(await rejected.json()).toMatchObject({ accepted: 0 });
    expect(tracked).toHaveLength(0);
  });

  it("does not expose interactions to a different token and rejects foreign devices", async () => {
    const created = await createInteraction({ title: "T", prompt: "P", kind: "reply" });
    const body = (await created.json()) as {
      interaction: { id: string; actionDigest: string };
    };
    expect((await agent(`/interactions/${body.interaction.id}`, OTHER_SECRET)).status).toBe(404);
    const foreign = await createInteraction({
      title: "T",
      prompt: "P",
      kind: "reply",
      deviceIds: ["dev_foreign"],
    });
    expect(foreign.status).toBe(400);
  });

  it("validates response kind and atomically accepts only the first device", async () => {
    const created = await createInteraction({
      title: "Release",
      prompt: "Ship?",
      kind: "approval",
    });
    const body = (await created.json()) as {
      interaction: { id: string; actionDigest: string };
    };
    const invalid = await app.request(`/api/interactions/${body.interaction.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reply",
        response: "yes",
        deviceId: "dev_1",
        actionDigest: body.interaction.actionDigest,
      }),
    });
    expect(invalid.status).toBe(400);

    const responses = await Promise.all(
      ["dev_1", "dev_2"].map((deviceId, index) =>
        app.request(`/api/interactions/${body.interaction.id}/respond`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: index === 0 ? "approve" : "deny",
            deviceId,
            actionDigest: body.interaction.actionDigest,
          }),
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = responses.find((response) => response.status === 200);
    expect(await winner?.json()).toMatchObject({
      interaction: { status: "approved", respondingDeviceId: "dev_1" },
    });
  });

  it("requires the exact action digest and an active responding device", async () => {
    const created = await createInteraction({
      title: "Release",
      prompt: "Ship?",
      kind: "approval",
    });
    const body = (await created.json()) as {
      interaction: { id: string; actionDigest: string };
    };
    const mismatch = await app.request(`/api/interactions/${body.interaction.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        deviceId: "dev_1",
        actionDigest: "f".repeat(64),
      }),
    });
    expect(mismatch.status).toBe(409);

    const { eq } = await import("drizzle-orm");
    await db.update(schema.device).set({ active: false }).where(eq(schema.device.id, "dev_2"));
    const inactive = await app.request(`/api/interactions/${body.interaction.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        deviceId: "dev_2",
        actionDigest: body.interaction.actionDigest,
      }),
    });
    await db.update(schema.device).set({ active: true }).where(eq(schema.device.id, "dev_2"));
    expect(inactive.status).toBe(404);
  });

  it("enforces account ownership and expires pending records", async () => {
    const now = new Date();
    await db.insert(schema.interaction).values({
      id: "int_expired",
      userId: "user_1",
      requesterTokenId: "tok_full",
      title: "Old",
      prompt: "Old prompt",
      kind: "reply",
      status: "pending",
      choices: ["reply"],
      actionDigest: "digest",
      expiresAt: new Date(now.getTime() - 1000),
      createdAt: new Date(now.getTime() - 2000),
    });
    const expired = await agent("/interactions/int_expired");
    expect(await expired.json()).toMatchObject({ interaction: { status: "expired" } });

    authState.userId = "user_2";
    const denied = await app.request("/api/interactions/int_expired/respond", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reply",
        response: "late",
        deviceId: "dev_foreign",
        actionDigest: "d".repeat(64),
      }),
    });
    authState.userId = "user_1";
    expect(denied.status).toBe(404);
  });

  it("supports text replies, bounded waits, and cancellation", async () => {
    const replyCreated = await createInteraction({
      title: "Release",
      prompt: "Release note?",
      kind: "reply",
    });
    const replyBody = (await replyCreated.json()) as {
      interaction: { id: string; actionDigest: string };
    };
    const replied = await app.request(`/api/interactions/${replyBody.interaction.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reply",
        response: "Ship it",
        deviceId: "dev_1",
        actionDigest: replyBody.interaction.actionDigest,
      }),
    });
    expect(await replied.json()).toMatchObject({
      interaction: { status: "replied", response: "Ship it" },
    });
    const waited = await agent(`/interactions/${replyBody.interaction.id}/wait?timeout=0`);
    expect(await waited.json()).toMatchObject({
      timedOut: false,
      interaction: { status: "replied" },
    });

    const pendingCreated = await createInteraction({
      title: "Release",
      prompt: "Cancel me",
      kind: "approval",
    });
    const pendingBody = (await pendingCreated.json()) as { interaction: { id: string } };
    const pendingWait = await agent(`/interactions/${pendingBody.interaction.id}/wait?timeout=0`);
    expect(await pendingWait.json()).toMatchObject({ timedOut: true });
    const canceled = await agent(`/interactions/${pendingBody.interaction.id}/cancel`, SECRET, {
      method: "POST",
    });
    expect(await canceled.json()).toMatchObject({ interaction: { status: "canceled" } });
    expect(
      (
        await agent(`/interactions/${pendingBody.interaction.id}/cancel`, SECRET, {
          method: "POST",
        })
      ).status,
    ).toBe(409);
  });

  it("stops a long poll when the request is aborted", async () => {
    const created = await createInteraction({
      title: "Release",
      prompt: "Wait for me",
      kind: "approval",
    });
    const body = (await created.json()) as { interaction: { id: string } };
    const controller = new AbortController();
    const waiting = agent(`/interactions/${body.interaction.id}/wait?timeout=25`, SECRET, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    expect((await waiting).status).toBe(499);
  });
});

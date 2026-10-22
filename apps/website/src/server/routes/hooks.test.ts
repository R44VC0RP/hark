import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const sent: Array<Record<string, unknown>> = [];
const billingTestState = vi.hoisted(() => ({
  pro: false,
  accountPerMinute: null as number | null,
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: billingTestState.pro ? "pro" : "free",
    priceMonthly: 8,
    features: { deviceRouting: billingTestState.pro },
    limits: {
      devices: billingTestState.pro ? null : 1,
      notificationsPerMonth: billingTestState.pro ? 100_000 : 10_000,
      servicePerMinute: billingTestState.pro ? 300 : 60,
      accountPerMinute: billingTestState.accountPerMinute ?? (billingTestState.pro ? 1500 : 300),
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
      sent.push(...chunk);
      return chunk.map((message) =>
        typeof message.to === "string" && message.to.includes("stale")
          ? {
              status: "error",
              message: "device gone",
              details: { error: "DeviceNotRegistered" },
            }
          : { status: "ok", id: "ticket" },
      );
    }
  }
  return { Expo, default: Expo };
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let hashWebhookToken: typeof import("../lib/token")["hashWebhookToken"];

const TOKEN = "whk_test-token-abcdefghijklmnopqrstuv";

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ hashWebhookToken } = await import("../lib/token"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values({
    id: "user_1",
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.service).values({
    id: "svc_1",
    userId: "user_1",
    title: "Acme CRM",
    imageUrl: "https://example.com/default.png",
    url: "https://example.com/app",
    tokenHash: hashWebhookToken(TOKEN),
    createdAt: now,
    updatedAt: now,
  });
});

async function post(token: string, body: unknown, idempotencyKey?: string) {
  return app.request(`/hooks/${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /hooks/:token", () => {
  it("404s on an unknown token without leaking details", async () => {
    const res = await post("whk_wrong", { body: "hi" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Unknown webhook" });
  });

  it("400s on an invalid payload", async () => {
    const res = await post(TOKEN, { title: "no body" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBe("Invalid payload");
  });

  it("reports no devices when none are registered", async () => {
    const res = await post(TOKEN, { body: "hello" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; delivered: number; message?: string };
    expect(json.ok).toBe(true);
    expect(json.delivered).toBe(0);
    expect(json.message).toContain("No active iOS devices");
  });

  it("delivers to active devices and resolves overrides", async () => {
    const now = new Date();
    await db.insert(schema.device).values({
      id: "dev_1",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[a]",
      platform: "ios",
      active: true,
      interactionSchemaVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    });

    sent.length = 0;
    const res = await post(TOKEN, { body: "Build failed", title: "CI" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; delivered: number; eventId: string };
    expect(json.ok).toBe(true);
    expect(json.delivered).toBe(1);
    expect(json.eventId).toMatch(/^evt_/);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[a]",
      title: "CI",
      body: "Build failed",
      mutableContent: true,
      priority: "high",
      // Falls back to the service image when the webhook has no override.
      richContent: { image: "https://example.com/default.png" },
    });
    const data = sent[0]?.data as Record<string, unknown>;
    expect(data.sourceName).toBe("CI");
    expect(data.conversationId).toBe("hark-svc_1");
    expect(JSON.stringify(sent[0])).not.toContain("user_1");
  });

  it("delivers to all active devices by default on Pro", async () => {
    const now = new Date();
    await db.insert(schema.device).values({
      id: "dev_2",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[b]",
      platform: "ios",
      active: true,
      interactionSchemaVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    });

    billingTestState.pro = true;
    sent.length = 0;
    const res = await post(TOKEN, { body: "Everyone" });
    billingTestState.pro = false;

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, delivered: 2 });
    expect(sent.map((message) => message.to).sort()).toEqual([
      "ExponentPushToken[a]",
      "ExponentPushToken[b]",
    ]);
  });

  it("routes a Pro notification only to selected devices", async () => {
    billingTestState.pro = true;
    sent.length = 0;
    const res = await post(TOKEN, { body: "Only A", deviceIds: ["dev_1"] });
    billingTestState.pro = false;

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, delivered: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ExponentPushToken[a]");
  });

  it("creates and resolves a Pro approval through the webhook event", async () => {
    billingTestState.pro = true;
    sent.length = 0;
    const created = await post(TOKEN, {
      body: "Deploy production?",
      title: "CI",
      imageUrl: "https://example.com/ci.png",
      deviceIds: ["dev_1"],
      response: {
        type: "approval",
        correlationId: "deploy-184",
        expiresInSeconds: 900,
        callback: {
          url: "https://ci.example.com/hark-response",
          token: "private-callback-token",
        },
      },
    });
    billingTestState.pro = false;
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { eventId: string };
    expect(createdBody).toMatchObject({
      ok: true,
      delivered: 1,
      response: { status: "pending" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      categoryId: "HARK_APPROVAL_V1",
      richContent: { image: "https://example.com/ci.png" },
    });
    const data = sent[0]?.data as {
      interactionId: string;
      responseToken: string;
      avatarUrl: string;
    };
    expect(data.avatarUrl).toBe("https://example.com/ci.png");

    const { default: dns } = await import("node:dns/promises");
    const { default: https } = await import("node:https");
    const { EventEmitter } = await import("node:events");
    const callbackLookup = vi
      .spyOn(dns, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    const callbackRequest = vi.spyOn(https, "request").mockImplementation(((
      _url: unknown,
      _options: unknown,
      onResponse: (response: { statusCode: number; resume(): void }) => void,
    ) => {
      const request = Object.assign(new EventEmitter(), {
        end: () => onResponse({ statusCode: 204, resume: () => undefined }),
      });
      return request;
    }) as never);
    const response = await app.request(`/api/interaction-responses/${data.interactionId}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        deviceId: "dev_1",
        responseToken: data.responseToken,
      }),
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(callbackRequest).toHaveBeenCalledOnce());
    const callbackCall = callbackRequest.mock.calls[0] as unknown as
      | [URL, { headers: Record<string, string> }]
      | undefined;
    if (!callbackCall) throw new Error("Expected callback request");
    expect(String(callbackCall[0])).toBe("https://ci.example.com/hark-response");
    expect(callbackCall[1].headers.authorization).toBe("Bearer private-callback-token");
    expect(callbackLookup).toHaveBeenCalledWith("ci.example.com", { all: true, verbatim: true });
    callbackRequest.mockRestore();
    callbackLookup.mockRestore();
    const status = await app.request(`/hooks/${TOKEN}/events/${createdBody.eventId}`);
    expect(await status.json()).toMatchObject({
      ok: true,
      event: {
        id: createdBody.eventId,
        response: { status: "approved", action: "approve", correlationId: "deploy-184" },
      },
    });
  });

  it("requires Pro for webhook responses", async () => {
    const response = await post(TOKEN, {
      body: "Deploy?",
      response: { type: "approval" },
    });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Interactive responses require Hark Pro",
    });
  });

  it("records credential text responses as replied", async () => {
    billingTestState.pro = true;
    sent.length = 0;
    const created = await post(TOKEN, {
      body: "Reply?",
      deviceIds: ["dev_1"],
      response: { type: "text" },
    });
    billingTestState.pro = false;
    const createdBody = (await created.json()) as { eventId: string };
    const data = sent[0]?.data as { interactionId: string; responseToken: string };
    // The token belongs to dev_1's push; naming another device does not work.
    const otherDevice = await app.request(
      `/api/interaction-responses/${data.interactionId}/respond`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          response: "Not mine",
          deviceId: "dev_2",
          responseToken: data.responseToken,
        }),
      },
    );
    expect(otherDevice.status).toBe(404);
    const response = await app.request(`/api/interaction-responses/${data.interactionId}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reply",
        response: "Build 11 works",
        deviceId: "dev_1",
        responseToken: data.responseToken,
      }),
    });
    expect(response.status).toBe(200);
    const status = await app.request(`/hooks/${TOKEN}/events/${createdBody.eventId}`);
    expect(await status.json()).toMatchObject({
      event: { response: { status: "replied", action: "reply", text: "Build 11 works" } },
    });
  });

  it("requires Pro for targeted device routing", async () => {
    const res = await post(TOKEN, { body: "Only A", deviceIds: ["dev_1"] });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Device routing requires Hark Pro",
    });
  });

  it("rejects device IDs owned by another account", async () => {
    const now = new Date();
    await db.insert(schema.user).values({
      id: "user_2",
      name: "Other User",
      email: "other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: "dev_foreign",
      userId: "user_2",
      expoPushToken: "ExponentPushToken[foreign]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });

    billingTestState.pro = true;
    sent.length = 0;
    const res = await post(TOKEN, { body: "No leak", deviceIds: ["dev_foreign"] });
    billingTestState.pro = false;

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Invalid device selection" });
    expect(sent).toHaveLength(0);
  });

  it("treats reordered device IDs as the same idempotent request", async () => {
    billingTestState.pro = true;
    sent.length = 0;
    const first = await post(TOKEN, { body: "Both", deviceIds: ["dev_1", "dev_2"] }, "targeted-1");
    const second = await post(TOKEN, { body: "Both", deviceIds: ["dev_2", "dev_1"] }, "targeted-1");
    billingTestState.pro = false;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, idempotent: true, delivered: 2 });
    expect(sent).toHaveLength(2);
  });

  it("suppresses duplicate requests with the same idempotency key", async () => {
    sent.length = 0;
    const first = await post(TOKEN, { body: "Only once", title: "CI" }, "deploy-184");
    const firstJson = (await first.json()) as { eventId: string; delivered: number };
    const second = await post(TOKEN, { body: "Only once", title: "CI" }, "deploy-184");
    const secondJson = (await second.json()) as {
      eventId: string;
      delivered: number;
      idempotent: boolean;
    };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondJson.eventId).toBe(firstJson.eventId);
    expect(secondJson.idempotent).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("rejects an idempotency key reused with a different payload", async () => {
    const res = await post(TOKEN, { body: "Different body" }, "deploy-184");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Idempotency-Key was already used with a different payload",
    });
  });

  it("deactivates devices Expo reports as unregistered", async () => {
    const now = new Date();
    await db.insert(schema.device).values({
      id: "dev_stale",
      userId: "user_1",
      expoPushToken: "ExponentPushToken[stale]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });

    billingTestState.pro = true;
    const res = await post(TOKEN, { body: "ping" });
    billingTestState.pro = false;
    expect(res.status).toBe(200);

    const { eq } = await import("drizzle-orm");
    const [stale] = await db.select().from(schema.device).where(eq(schema.device.id, "dev_stale"));
    expect(stale?.active).toBe(false);
  });

  it("never returns provider error detail when every push fails", async () => {
    const now = new Date();
    const failToken = "whk_fail-only-abcdefghijklmnopqrstu";
    await db.insert(schema.user).values({
      id: "user_fail",
      name: "Fail User",
      email: "fail@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.service).values({
      id: "svc_fail",
      userId: "user_fail",
      title: "Fail only",
      tokenHash: hashWebhookToken(failToken),
      createdAt: now,
      updatedAt: now,
    });
    // The Expo mock only fails this token, and it is unique across devices.
    const { eq } = await import("drizzle-orm");
    await db
      .delete(schema.device)
      .where(eq(schema.device.expoPushToken, "ExponentPushToken[stale]"));
    await db.insert(schema.device).values({
      id: "dev_fail_only",
      userId: "user_fail",
      expoPushToken: "ExponentPushToken[stale]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });

    const res = await post(failToken, { body: "ping" });
    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(raw).not.toContain("ExponentPushToken");
    expect(raw).not.toContain("device gone");
    expect(JSON.parse(raw)).toEqual({ ok: false, error: "Push delivery failed" });
  });

  it("rejects unauthenticated access to the services API", async () => {
    const res = await app.request("/api/services");
    expect(res.status).toBe(401);
  });

  it("enforces the per-service rate limit", async () => {
    const now = new Date();
    const limitToken = "whk_limit-test-abcdefghijklmnopqrst";
    await db.insert(schema.service).values({
      id: "svc_limit",
      userId: "user_1",
      title: "Limited",
      tokenHash: hashWebhookToken(limitToken),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.event).values(
      Array.from({ length: 60 }, (_, index) => ({
        id: `evt_limit_${index}`,
        serviceId: "svc_limit",
        title: "Limited",
        body: "test",
        status: "accepted",
        deliveredCount: 1,
        createdAt: now,
      })),
    );

    const res = await post(limitToken, { body: "one too many" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Service rate limit exceeded",
      retryAfterSeconds: 60,
    });
  });

  it("counts recent interactions toward the webhook account rate limit", async () => {
    const now = new Date();
    await db.insert(schema.user).values({
      id: "user_hook_combined_rate",
      name: "Combined Rate",
      email: "combined-rate@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    const combinedToken = "whk_combined-rate-abcdefghijklmnopqr";
    await db.insert(schema.service).values({
      id: "svc_hook_combined_rate",
      userId: "user_hook_combined_rate",
      title: "Combined",
      tokenHash: hashWebhookToken(combinedToken),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apiToken).values({
      id: "tok_hook_combined_rate",
      userId: "user_hook_combined_rate",
      name: "Combined",
      tokenHash: "hook_combined_hash",
      prefix: "hark_combine",
      scopes: ["interactions:create"],
      createdAt: now,
    });
    await db.insert(schema.interaction).values({
      id: "int_hook_combined_rate",
      userId: "user_hook_combined_rate",
      requesterTokenId: "tok_hook_combined_rate",
      title: "Recent",
      prompt: "Count this",
      kind: "approval",
      status: "pending",
      choices: ["approve", "deny"],
      actionDigest: "combined-rate-digest",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });

    billingTestState.accountPerMinute = 1;
    const response = await post(combinedToken, { body: "one too many" });
    billingTestState.accountPerMinute = null;
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "Account rate limit exceeded" });
  });
});

describe("POST /hooks/:token/events/:eventId/withdraw", () => {
  it("authenticates ownership, sends a silent command, and cancels a pending response", async () => {
    const now = new Date();
    const token = "whk_withdraw-test-abcdefghijklmnopqr";
    const eventId = "evt_withdraw_test";
    await db.insert(schema.user).values({
      id: "user_withdraw",
      name: "Withdraw Test",
      email: "withdraw@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.service).values({
      id: "svc_withdraw",
      userId: "user_withdraw",
      title: "Withdraw Test",
      tokenHash: hashWebhookToken(token),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: "dev_withdraw",
      userId: "user_withdraw",
      expoPushToken: "ExponentPushToken[withdraw]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
    await db.insert(schema.event).values({
      id: eventId,
      serviceId: "svc_withdraw",
      title: "CI",
      body: "Old result",
      status: "accepted",
      deliveredCount: 1,
      createdAt: now,
    });
    await db.insert(schema.interaction).values({
      id: "int_withdraw",
      userId: "user_withdraw",
      requesterServiceId: "svc_withdraw",
      eventId,
      title: "CI",
      prompt: "Continue?",
      kind: "approval",
      status: "pending",
      choices: ["approve", "deny"],
      actionDigest: "withdraw-digest",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });

    const denied = await app.request(`/hooks/whk_wrong/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(denied.status).toBe(404);
    expect(await denied.json()).toEqual({ ok: false, error: "Event not found" });

    sent.length = 0;
    const response = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      eventId,
      status: "withdrawn",
      accepted: 1,
    });
    expect(sent).toEqual([
      {
        to: "ExponentPushToken[withdraw]",
        data: { v: 1, command: "notification.withdraw", eventId },
        _contentAvailable: true,
      },
    ]);

    const { eq } = await import("drizzle-orm");
    const [savedEvent] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));
    const [savedInteraction] = await db
      .select()
      .from(schema.interaction)
      .where(eq(schema.interaction.id, "int_withdraw"));
    expect(savedEvent?.status).toBe("withdrawn");
    // Withdrawal marks the event read so it cannot linger as a ghost unread item.
    expect(savedEvent?.readAt).toBeInstanceOf(Date);
    expect(savedInteraction).toMatchObject({ status: "canceled" });
    expect(savedInteraction?.canceledAt).toBeInstanceOf(Date);

    const repeated = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({
      ok: true,
      eventId,
      status: "withdrawn",
      accepted: 0,
      idempotent: true,
    });
    expect(sent).toHaveLength(1);
  });

  it("does not mark an event withdrawn when Expo rejects every command", async () => {
    const now = new Date();
    const token = "whk_withdraw-fail-abcdefghijklmnopqr";
    const eventId = "evt_withdraw_fail";
    await db.insert(schema.user).values({
      id: "user_withdraw_fail",
      name: "Withdraw Failure",
      email: "withdraw-fail@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.service).values({
      id: "svc_withdraw_fail",
      userId: "user_withdraw_fail",
      title: "Withdraw Failure",
      tokenHash: hashWebhookToken(token),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: "dev_withdraw_fail",
      userId: "user_withdraw_fail",
      expoPushToken: "ExponentPushToken[withdraw-stale]",
      platform: "ios",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });
    await db.insert(schema.event).values({
      id: eventId,
      serviceId: "svc_withdraw_fail",
      title: "CI",
      body: "Old result",
      status: "accepted",
      deliveredCount: 1,
      createdAt: now,
    });

    const response = await app.request(`/hooks/${token}/events/${eventId}/withdraw`, {
      method: "POST",
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Withdrawal delivery failed",
    });

    const { eq } = await import("drizzle-orm");
    const [savedEvent] = await db.select().from(schema.event).where(eq(schema.event.id, eventId));
    const [savedDevice] = await db
      .select()
      .from(schema.device)
      .where(eq(schema.device.id, "dev_withdraw_fail"));
    expect(savedEvent?.status).toBe("accepted");
    expect(savedDevice?.active).toBe(false);
  });
});

describe("webhook project, summary, and body capacity", () => {
  it("stores project, summary, and bodyFormat and reuses projects case-insensitively", async () => {
    const { and, eq } = await import("drizzle-orm");
    sent.length = 0;
    const first = await post(TOKEN, {
      body: "Deploy finished",
      project: "Acme App",
      summary: "Deploy digest",
      bodyFormat: "markdown",
    });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { eventId: string; message?: string };
    expect(firstJson.message).toBeUndefined();

    const [firstEvent] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, firstJson.eventId));
    expect(firstEvent).toMatchObject({
      summary: "Deploy digest",
      bodyFormat: "markdown",
      readAt: null,
    });
    expect(firstEvent?.projectId).toMatch(/^prj_/);

    // NFC + case-insensitive identity: "acme APP" reuses the same project.
    const second = await post(TOKEN, { body: "Second", project: "acme APP" });
    const secondJson = (await second.json()) as { eventId: string };
    const [secondEvent] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, secondJson.eventId));
    expect(secondEvent?.projectId).toBe(firstEvent?.projectId);

    const [projectRow] = await db
      .select()
      .from(schema.project)
      .where(
        and(eq(schema.project.userId, "user_1"), eq(schema.project.normalizedName, "acme app")),
      );
    // The display name keeps the first sender's casing.
    expect(projectRow?.name).toBe("Acme App");

    // The push carries the summary and the project metadata, never the raw body.
    expect(sent[0]).toMatchObject({ body: "Deploy digest" });
    expect(((sent[0]?.data ?? {}) as Record<string, unknown>).projectId).toBe(
      firstEvent?.projectId,
    );
  });

  it("keeps the replayed event's original project when the name is reused", async () => {
    const { eq } = await import("drizzle-orm");
    const first = await post(TOKEN, { body: "Replay", project: "Replay Project" }, "replay-prj");
    const firstJson = (await first.json()) as { eventId: string };
    const [firstEvent] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, firstJson.eventId));

    const replay = await post(TOKEN, { body: "Replay", project: "Replay Project" }, "replay-prj");
    const replayJson = (await replay.json()) as { eventId: string; idempotent?: boolean };
    expect(replayJson.idempotent).toBe(true);
    expect(replayJson.eventId).toBe(firstJson.eventId);
    const [replayEvent] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, replayJson.eventId));
    expect(replayEvent?.projectId).toBe(firstEvent?.projectId);
  });

  it("scopes projects to the token owner's account", async () => {
    const { eq } = await import("drizzle-orm");
    const now = new Date();
    const otherToken = "whk_project-isolation-abcdefghijklmn";
    await db.insert(schema.user).values({
      id: "user_prj_other",
      name: "Other",
      email: "prj-other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.service).values({
      id: "svc_prj_other",
      userId: "user_prj_other",
      title: "Other service",
      tokenHash: hashWebhookToken(otherToken),
      createdAt: now,
      updatedAt: now,
    });

    const response = await post(otherToken, { body: "Hi", project: "Acme App" });
    expect(response.status).toBe(200);
    const rows = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.normalizedName, "acme app"));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.userId))).toEqual(new Set(["user_1", "user_prj_other"]));
  });

  it("degrades to Unfiled with a message instead of failing at the project cap", async () => {
    const { eq } = await import("drizzle-orm");
    const { MAX_PROJECTS_PER_ACCOUNT } = await import("@hark/contracts");
    const now = new Date();
    const existing = await db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(eq(schema.project.userId, "user_1"));
    const fillers = Array.from(
      { length: MAX_PROJECTS_PER_ACCOUNT - existing.length },
      (_, index) => ({
        id: `prj_fill_${index}`,
        userId: "user_1",
        name: `Filler ${index}`,
        normalizedName: `filler ${index}`,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await db.insert(schema.project).values(fillers);

    const response = await post(TOKEN, { body: "Over cap", project: "Brand New Project" });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; eventId: string; message?: string };
    expect(json.ok).toBe(true);
    expect(json.message).toContain("Project limit reached");

    const [row] = await db.select().from(schema.event).where(eq(schema.event.id, json.eventId));
    expect(row?.projectId).toBeNull();

    // An existing project still resolves at the cap.
    const reuse = await post(TOKEN, { body: "Reuse", project: "ACME app" });
    const reuseJson = (await reuse.json()) as { eventId: string; message?: string };
    expect(reuseJson.message).toBeUndefined();
    const [reuseRow] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, reuseJson.eventId));
    expect(reuseRow?.projectId).toMatch(/^prj_/);

    await db.delete(schema.project).where(eq(schema.project.name, "Filler 0"));
  });

  it("accepts an 8,000-character body and keeps the push below the APNs cap", async () => {
    const { eq } = await import("drizzle-orm");
    sent.length = 0;
    const body = `head ${"気配り🚀 ".repeat(1_100)}tail`.slice(0, 8_000);
    const response = await post(TOKEN, { body });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { eventId: string };

    const [row] = await db
      .select({ body: schema.event.body })
      .from(schema.event)
      .where(eq(schema.event.id, json.eventId));
    expect(row?.body).toBe(body);

    expect(sent).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(sent[0]), "utf8")).toBeLessThanOrEqual(4_096);
    expect(String(sent[0]?.body).endsWith("…")).toBe(true);
  });

  it("rejects a body over the UTF-8 byte cap with a validation error", async () => {
    const response = await post(TOKEN, { body: "気".repeat(6_000) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "Invalid payload" });
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "activity_user_1" as string | null }));
const apnsCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const apnsState = vi.hoisted(() => ({ rejectEvent: null as string | null }));
const billingState = vi.hoisted(() => ({ pro: true, serviceRate: 1000, accountRate: 1000 }));

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: "Activity User",
                email: "activity@example.com",
                image: null,
              },
            }
          : null,
    },
  },
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    plan: billingState.pro ? "pro" : "free",
    features: { deviceRouting: billingState.pro },
    limits: {
      devices: billingState.pro ? null : 1,
      servicePerMinute: billingState.serviceRate,
      accountPerMinute: billingState.accountRate,
    },
  }),
  checkNotificationAllowance: async () => true,
  trackNotification: async () => undefined,
  hasAutumn: () => false,
  clearBillingCache: () => undefined,
  createCheckout: async () => "https://example.test",
  createBillingPortal: async () => "https://example.test",
}));

vi.mock("../lib/apns", () => ({
  isInvalidApnsTokenReason: (reason: string | null) => reason === "Unregistered",
  sendLiveActivityPush: async (
    token: string,
    environment: string,
    input: Record<string, unknown>,
    priority: number,
  ) => {
    apnsCalls.push({ token, environment, input, priority });
    if (input.event === apnsState.rejectEvent) {
      return { status: 503, apnsId: null, reason: "Unavailable", accepted: false };
    }
    return { status: 200, apnsId: `apns-${apnsCalls.length}`, reason: null, accepted: true };
  },
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let encryptLiveActivityToken: typeof import("../lib/token")["encryptLiveActivityToken"];
let decryptLiveActivityToken: typeof import("../lib/token")["decryptLiveActivityToken"];
let hashApiToken: typeof import("../lib/token")["hashApiToken"];

const WRITE_SECRET = `hark_${"l".repeat(43)}`;
const READ_SECRET = `hark_${"m".repeat(43)}`;
const OTHER_SECRET = `hark_${"n".repeat(43)}`;

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ decryptLiveActivityToken, encryptLiveActivityToken, hashApiToken } = await import(
    "../lib/token"
  ));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "activity_user_1",
      name: "Activity User",
      email: "activity@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "activity_user_2",
      name: "Other Activity User",
      email: "other-activity@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.device).values([
    {
      id: "activity_dev_1",
      userId: "activity_user_1",
      expoPushToken: "ExponentPushToken[activity-1]",
      platform: "ios",
      active: true,
      liveActivityPushToStartTokenCiphertext: encryptLiveActivityToken("aa".repeat(32)),
      liveActivityTokenEnvironment: "sandbox",
      liveActivitySchemaVersion: 1,
      liveActivityTokenUpdatedAt: now,
      createdAt: now,
      lastSeenAt: now,
    },
    {
      id: "activity_dev_2",
      userId: "activity_user_1",
      expoPushToken: "ExponentPushToken[activity-2]",
      apnsToken: "cc".repeat(32),
      platform: "ios",
      active: true,
      liveActivityPushToStartTokenCiphertext: encryptLiveActivityToken("bb".repeat(32)),
      liveActivityTokenEnvironment: "sandbox",
      liveActivitySchemaVersion: 1,
      liveActivityTokenUpdatedAt: now,
      createdAt: now,
      lastSeenAt: new Date(now.getTime() - 1000),
    },
    {
      id: "activity_dev_foreign",
      userId: "activity_user_2",
      expoPushToken: "ExponentPushToken[activity-foreign]",
      platform: "ios",
      active: true,
      liveActivityPushToStartTokenCiphertext: encryptLiveActivityToken("cc".repeat(32)),
      liveActivityTokenEnvironment: "sandbox",
      liveActivitySchemaVersion: 1,
      liveActivityTokenUpdatedAt: now,
      createdAt: now,
      lastSeenAt: now,
    },
  ]);
  await db.insert(schema.apiToken).values([
    {
      id: "activity_tok_write",
      userId: "activity_user_1",
      name: "Activity write",
      tokenHash: hashApiToken(WRITE_SECRET),
      prefix: WRITE_SECRET.slice(0, 13),
      scopes: ["activities:read", "activities:write"],
      createdAt: now,
    },
    {
      id: "activity_tok_read",
      userId: "activity_user_1",
      name: "Activity read",
      tokenHash: hashApiToken(READ_SECRET),
      prefix: READ_SECRET.slice(0, 13),
      scopes: ["activities:read"],
      createdAt: now,
    },
    {
      id: "activity_tok_other",
      userId: "activity_user_1",
      name: "Other requester",
      tokenHash: hashApiToken(OTHER_SECRET),
      prefix: OTHER_SECRET.slice(0, 13),
      scopes: ["activities:read", "activities:write"],
      createdAt: now,
    },
  ]);
});

beforeEach(async () => {
  authState.userId = "activity_user_1";
  billingState.pro = true;
  billingState.serviceRate = 1000;
  billingState.accountRate = 1000;
  apnsCalls.length = 0;
  apnsState.rejectEvent = null;
  await db.delete(schema.liveActivity);
  const { eq } = await import("drizzle-orm");
  await db
    .update(schema.device)
    .set({
      userId: "activity_user_1",
      active: true,
      liveActivityPushToStartTokenCiphertext: encryptLiveActivityToken("aa".repeat(32)),
      liveActivityTokenEnvironment: "sandbox",
      liveActivitySchemaVersion: 1,
    })
    .where(eq(schema.device.id, "activity_dev_1"));
  await db
    .update(schema.device)
    .set({
      userId: "activity_user_1",
      active: true,
      liveActivityPushToStartTokenCiphertext: encryptLiveActivityToken("bb".repeat(32)),
      liveActivityTokenEnvironment: "sandbox",
      liveActivitySchemaVersion: 1,
    })
    .where(eq(schema.device.id, "activity_dev_2"));
});

function agent(path: string, token = WRITE_SECRET, init?: RequestInit) {
  return app.request(`/api/agent/activities${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

async function start(
  body: Record<string, unknown> = { title: "Release", status: "Starting" },
  idempotency?: string,
) {
  return agent("", WRITE_SECRET, {
    method: "POST",
    headers: idempotency ? { "Idempotency-Key": idempotency } : undefined,
    body: JSON.stringify(body),
  });
}

async function registerUpdateToken(
  activityId: string | undefined,
  nativeActivityId: string | undefined,
  updateToken: string,
  deviceId = "activity_dev_1",
) {
  return app.request("/api/devices/live-activity/update-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId,
      ...(activityId ? { activityId } : {}),
      ...(nativeActivityId ? { nativeActivityId } : {}),
      updateToken,
      environment: "sandbox",
      schemaVersion: 1,
    }),
  });
}

describe("Live Activity agent routes", () => {
  it("requires write scope and requester ownership", async () => {
    const denied = await agent("", READ_SECRET, {
      method: "POST",
      body: JSON.stringify({ title: "No", status: "No" }),
    });
    expect(denied.status).toBe(403);
    const created = await start();
    const body = (await created.json()) as { activity: { id: string } };
    expect((await agent(`/${body.activity.id}`, OTHER_SECRET)).status).toBe(404);
  });

  it("starts with exact expo-widgets content and is idempotent", async () => {
    const first = await start(
      {
        title: "Release",
        status: "Building",
        progress: 0.2,
        key: "release-main",
        accentColor: "#FF9F0A",
        style: "ring",
      },
      "start-release",
    );
    expect(first.status).toBe(201);
    const body = (await first.json()) as { activity: { id: string }; accepted: number };
    expect(body.accepted).toBe(2);
    expect(apnsCalls).toHaveLength(2);
    expect(apnsCalls[0]).toMatchObject({
      environment: "sandbox",
      priority: 10,
      input: {
        event: "start",
        props: {
          activityId: body.activity.id,
          title: "Release",
          status: "Building",
          progress: 0.2,
          accentColor: "#FF9F0A",
          style: "ring",
        },
      },
    });
    const replay = await start(
      {
        title: "Release",
        status: "Building",
        progress: 0.2,
        key: "release-main",
        accentColor: "#FF9F0A",
        style: "ring",
      },
      "start-release",
    );
    expect(await replay.json()).toMatchObject({
      idempotent: true,
      activity: { id: body.activity.id },
    });
    expect(apnsCalls).toHaveLength(2);
    expect((await start({ title: "Changed", status: "Building" }, "start-release")).status).toBe(
      409,
    );
  });

  it("applies Free device caps and makes targeted routing Pro-only", async () => {
    billingState.pro = false;
    expect(await (await start({ title: "Free", status: "Start" })).json()).toMatchObject({
      accepted: 1,
    });
    expect(apnsCalls).toHaveLength(1);
    const targeted = await start({
      title: "Free",
      status: "Start",
      deviceIds: ["activity_dev_2"],
    });
    expect(targeted.status).toBe(402);
    billingState.pro = true;
    const foreign = await start({
      title: "Pro",
      status: "Start",
      deviceIds: ["activity_dev_foreign"],
    });
    expect(foreign.status).toBe(400);
  });

  it("enforces requester rate limits", async () => {
    billingState.serviceRate = 0;
    const response = await start();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toMatchObject({ error: "Requester rate limit exceeded" });
  });

  it("registers encrypted tokens only for an owned device and activity", async () => {
    const token = "dd".repeat(32);
    const registered = await app.request("/api/devices/live-activity/push-to-start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "activity_dev_1",
        pushToStartToken: token,
        environment: "sandbox",
        schemaVersion: 1,
      }),
    });
    expect(registered.status).toBe(200);
    const { eq } = await import("drizzle-orm");
    const [stored] = await db
      .select({ token: schema.device.liveActivityPushToStartTokenCiphertext })
      .from(schema.device)
      .where(eq(schema.device.id, "activity_dev_1"));
    expect(stored?.token).not.toContain(token);
    expect(decryptLiveActivityToken(stored?.token ?? "")).toBe(token);

    authState.userId = "activity_user_2";
    const foreign = await app.request("/api/devices/live-activity/push-to-start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "activity_dev_1",
        pushToStartToken: token,
        environment: "sandbox",
        schemaVersion: 1,
      }),
    });
    expect(foreign.status).toBe(404);
  });

  it("registers an update token then rejects stale sequences", async () => {
    const created = await start({
      title: "Sequence",
      status: "Starting",
      deviceIds: ["activity_dev_1"],
    });
    const startBody = (await created.json()) as { activity: { id: string; sequence: number } };
    const registration = await app.request("/api/devices/live-activity/update-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "activity_dev_1",
        activityId: startBody.activity.id,
        nativeActivityId: "native-1",
        updateToken: "ee".repeat(32),
        environment: "sandbox",
        schemaVersion: 1,
      }),
    });
    expect(registration.status).toBe(200);

    apnsCalls.length = 0;
    const updated = await agent(`/${startBody.activity.id}`, WRITE_SECRET, {
      method: "PATCH",
      headers: { "Idempotency-Key": "sequence-update" },
      body: JSON.stringify({
        status: "Testing",
        progress: 0.5,
        accentColor: "#64D2FF",
        ifSequence: 0,
      }),
    });
    expect(await updated.json()).toMatchObject({
      accepted: 1,
      activity: {
        sequence: 1,
        props: { status: "Testing", progress: 0.5, accentColor: "#64D2FF" },
      },
    });
    expect(apnsCalls[0]).toMatchObject({ token: "ee".repeat(32), priority: 10 });

    const stale = await agent(`/${startBody.activity.id}`, WRITE_SECRET, {
      method: "PATCH",
      body: JSON.stringify({ status: "Late", ifSequence: 0 }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "Sequence conflict" });
  });

  it("rotates the token for an already associated native activity", async () => {
    const created = await start({
      title: "Rotation",
      status: "Starting",
      deviceIds: ["activity_dev_1"],
    });
    const body = (await created.json()) as { activity: { id: string } };
    expect(
      (await registerUpdateToken(body.activity.id, "native-rotation", "12".repeat(32))).status,
    ).toBe(200);

    const rotated = await registerUpdateToken(undefined, "native-rotation", "34".repeat(32));
    expect(rotated.status).toBe(200);
    expect(await rotated.json()).toMatchObject({ activityId: body.activity.id });

    const { eq } = await import("drizzle-orm");
    const delivery = db
      .select({ token: schema.liveActivityDelivery.updateTokenCiphertext })
      .from(schema.liveActivityDelivery)
      .where(eq(schema.liveActivityDelivery.activityId, body.activity.id))
      .get();
    expect(decryptLiveActivityToken(delivery?.token ?? "")).toBe("34".repeat(32));
  });

  it("rejects a second active Hark activity on the same device", async () => {
    const first = await start({
      title: "Associated",
      status: "Starting",
      deviceIds: ["activity_dev_1"],
    });
    const firstBody = (await first.json()) as { activity: { id: string } };
    const second = await start({
      title: "Pending",
      status: "Starting",
      deviceIds: ["activity_dev_1"],
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      code: "ACTIVE_ACTIVITY_CONFLICT",
      activityId: firstBody.activity.id,
    });
  });

  it("replaces the blocking activity when replace is true", async () => {
    const first = await start({
      title: "Old run",
      status: "Running",
      deviceIds: ["activity_dev_1"],
    });
    const firstBody = (await first.json()) as { activity: { id: string } };
    expect(
      (await registerUpdateToken(firstBody.activity.id, "native-replaced", "ba".repeat(32))).status,
    ).toBe(200);

    apnsCalls.length = 0;
    const second = await start({
      title: "New run",
      status: "Starting",
      replace: true,
      deviceIds: ["activity_dev_1"],
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { activity: { id: string } };
    expect(secondBody).toMatchObject({ accepted: 1, replaced: 1 });

    expect(apnsCalls).toHaveLength(2);
    expect(apnsCalls[0]).toMatchObject({
      token: "ba".repeat(32),
      priority: 10,
      input: { event: "end", props: { activityId: firstBody.activity.id, title: "Old run" } },
    });
    expect(apnsCalls[1]).toMatchObject({
      input: { event: "start", props: { activityId: secondBody.activity.id } },
    });

    const { eq } = await import("drizzle-orm");
    const oldActivity = db
      .select()
      .from(schema.liveActivity)
      .where(eq(schema.liveActivity.id, firstBody.activity.id))
      .get();
    expect(oldActivity).toMatchObject({ status: "ended" });
    expect(oldActivity?.endedAt).not.toBeNull();
    const oldDelivery = db
      .select()
      .from(schema.liveActivityDelivery)
      .where(eq(schema.liveActivityDelivery.activityId, firstBody.activity.id))
      .get();
    expect(oldDelivery).toMatchObject({ status: "ended", lastEvent: "end" });
  });

  it("reuses a key after the keyed activity ends", async () => {
    const first = await start({
      title: "Keyed",
      status: "Running",
      key: "deploy",
      deviceIds: ["activity_dev_1"],
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { activity: { id: string } };
    expect(
      (
        await agent("/deploy/end", WRITE_SECRET, {
          method: "POST",
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(200);

    const second = await start({
      title: "Keyed again",
      status: "Running",
      key: "deploy",
      deviceIds: ["activity_dev_1"],
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { activity: { id: string } };
    expect(secondBody.activity.id).not.toBe(firstBody.activity.id);

    const read = await agent("/deploy");
    expect(await read.json()).toMatchObject({ activity: { id: secondBody.activity.id } });
  });

  it("uses strictly increasing APNs timestamps for same-second updates", async () => {
    const created = await start({
      title: "Timestamp",
      status: "Starting",
      deviceIds: ["activity_dev_1"],
    });
    const body = (await created.json()) as { activity: { id: string } };
    await registerUpdateToken(body.activity.id, "native-timestamp", "9a".repeat(32));
    apnsCalls.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:34:56.000Z"));
    try {
      await agent(`/${body.activity.id}`, WRITE_SECRET, {
        method: "PATCH",
        body: JSON.stringify({ status: "First" }),
      });
      await agent(`/${body.activity.id}`, WRITE_SECRET, {
        method: "PATCH",
        body: JSON.stringify({ status: "Second" }),
      });
    } finally {
      vi.useRealTimers();
    }
    const timestamps = apnsCalls.map((call) => (call.input as { timestamp: number }).timestamp);
    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]).toBe((timestamps[0] ?? 0) + 1);
  });

  it("keeps a zero-acceptance update retryable and the device occupied", async () => {
    const created = await start({
      title: "No update token",
      status: "Starting",
      deviceIds: ["activity_dev_2"],
    });
    const body = (await created.json()) as { activity: { id: string } };
    const response = await agent(`/${body.activity.id}`, WRITE_SECRET, {
      method: "PATCH",
      body: JSON.stringify({ status: "Cannot deliver" }),
    });
    expect(await response.json()).toMatchObject({
      accepted: 0,
      failed: 1,
      activity: { status: "active" },
    });
    const conflicting = await start({
      title: "Still occupied",
      status: "Starting",
      deviceIds: ["activity_dev_2"],
    });
    expect(conflicting.status).toBe(409);
  });

  it("ends terminally with optimistic sequencing", async () => {
    const created = await start({ title: "End", status: "Running", deviceIds: ["activity_dev_1"] });
    const body = (await created.json()) as { activity: { id: string } };
    await app.request("/api/devices/live-activity/update-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "activity_dev_1",
        activityId: body.activity.id,
        updateToken: "ff".repeat(32),
        environment: "sandbox",
        schemaVersion: 1,
      }),
    });
    const ended = await agent(`/${body.activity.id}/end`, WRITE_SECRET, {
      method: "POST",
      body: JSON.stringify({ status: "Complete", progress: 1, ifSequence: 0 }),
    });
    expect(await ended.json()).toMatchObject({
      accepted: 1,
      activity: { status: "ended", sequence: 1, props: { status: "Complete", progress: 1 } },
    });
    expect(apnsCalls.at(-1)).toMatchObject({ priority: 10, input: { event: "end" } });
    expect(
      (
        await agent(`/${body.activity.id}/end`, WRITE_SECRET, {
          method: "POST",
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(409);
  });

  it("releases the device lock when an end push is rejected", async () => {
    const created = await start({
      title: "Dismissed",
      status: "Running",
      deviceIds: ["activity_dev_1"],
    });
    const body = (await created.json()) as { activity: { id: string } };
    await registerUpdateToken(body.activity.id, "native-dismissed", "cd".repeat(32));
    apnsState.rejectEvent = "end";
    const ended = await agent(`/${body.activity.id}/end`, WRITE_SECRET, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(await ended.json()).toMatchObject({
      accepted: 0,
      failed: 1,
      activity: { status: "ended" },
    });
    apnsState.rejectEvent = null;
    const replacement = await start({
      title: "Replacement",
      status: "Starting",
      deviceIds: ["activity_dev_1"],
    });
    expect(replacement.status).toBe(201);
  });

  it("revokes Live Activity capability atomically when device ownership changes", async () => {
    const created = await start({
      title: "Transferred",
      status: "Running",
      deviceIds: ["activity_dev_2"],
    });
    const body = (await created.json()) as { activity: { id: string } };
    await registerUpdateToken(
      body.activity.id,
      "native-transfer",
      "ab".repeat(32),
      "activity_dev_2",
    );

    authState.userId = "activity_user_2";
    const transfer = await app.request("/api/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expoPushToken: "ExponentPushToken[activity-2]",
        // The phone proves possession with the APNs token already on the row.
        apnsToken: "cc".repeat(32),
        platform: "ios",
        deviceName: "Transferred phone",
      }),
    });
    expect(transfer.status).toBe(201);
    authState.userId = "activity_user_1";

    const { eq } = await import("drizzle-orm");
    const transferredDevice = db
      .select()
      .from(schema.device)
      .where(eq(schema.device.id, "activity_dev_2"))
      .get();
    const transferredDelivery = db
      .select()
      .from(schema.liveActivityDelivery)
      .where(eq(schema.liveActivityDelivery.activityId, body.activity.id))
      .get();
    expect(transferredDevice).toMatchObject({
      userId: "activity_user_2",
      liveActivityPushToStartTokenCiphertext: null,
      liveActivityTokenEnvironment: null,
      liveActivitySchemaVersion: null,
      liveActivityTokenUpdatedAt: null,
    });
    expect(transferredDelivery).toMatchObject({
      status: "failed",
      updateTokenCiphertext: null,
      updateTokenUpdatedAt: null,
      lastApnsReason: "OwnerChanged",
    });

    apnsCalls.length = 0;
    const update = await agent(`/${body.activity.id}`, WRITE_SECRET, {
      method: "PATCH",
      body: JSON.stringify({ status: "Must not dispatch" }),
    });
    expect(await update.json()).toMatchObject({ accepted: 0, activity: { status: "failed" } });
    expect(apnsCalls).toHaveLength(0);
  });
});

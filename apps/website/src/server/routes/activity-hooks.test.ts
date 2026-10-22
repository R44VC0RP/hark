import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "hook_activity_user" as string | null }));
const apnsCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const billingState = vi.hoisted(() => ({ pro: true }));

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: "Hook Activity User",
                email: "hook-activity@example.com",
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
      servicePerMinute: 1000,
      accountPerMinute: 1000,
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
  isInvalidApnsTokenReason: () => false,
  sendLiveActivityPush: async (
    token: string,
    environment: string,
    input: Record<string, unknown>,
    priority: number,
  ) => {
    apnsCalls.push({ token, environment, input, priority });
    return { status: 200, apnsId: `hook-apns-${apnsCalls.length}`, reason: null, accepted: true };
  },
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let encryptLiveActivityToken: typeof import("../lib/token")["encryptLiveActivityToken"];
let hashWebhookToken: typeof import("../lib/token")["hashWebhookToken"];

const TOKEN = "whk_live-activity-abcdefghijklmnop";
const OTHER_TOKEN = "whk_live-activity-other-abcdefghij";

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ encryptLiveActivityToken, hashWebhookToken } = await import("../lib/token"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values({
    id: "hook_activity_user",
    name: "Hook Activity User",
    email: "hook-activity@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.service).values([
    {
      id: "hook_activity_service",
      userId: "hook_activity_user",
      title: "Deployments",
      tokenHash: hashWebhookToken(TOKEN),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "hook_activity_other_service",
      userId: "hook_activity_user",
      title: "Other",
      tokenHash: hashWebhookToken(OTHER_TOKEN),
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.device).values({
    id: "hook_activity_device",
    userId: "hook_activity_user",
    expoPushToken: "ExponentPushToken[hook-activity]",
    platform: "ios",
    active: true,
    liveActivityPushToStartTokenCiphertext: encryptLiveActivityToken("aa".repeat(32)),
    liveActivityTokenEnvironment: "sandbox",
    liveActivitySchemaVersion: 1,
    liveActivityTokenUpdatedAt: now,
    createdAt: now,
    lastSeenAt: now,
  });
});

beforeEach(async () => {
  authState.userId = "hook_activity_user";
  apnsCalls.length = 0;
  billingState.pro = true;
  await db.delete(schema.liveActivity);
});

function activityRequest(
  token: string,
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
  idempotencyKey?: string,
) {
  return app.request(`/hooks/${token}/live-activities${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function start(token = TOKEN, idempotencyKey?: string) {
  return activityRequest(
    token,
    "",
    "POST",
    {
      title: "Deploy #184",
      status: "Building",
      progress: 0,
      symbol: "build",
      accentColor: "#FF9F0A",
      deviceIds: ["hook_activity_device"],
    },
    idempotencyKey,
  );
}

describe("Live Activity webhook routes", () => {
  it("starts, updates, reads, and ends one stateful activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
    try {
      const started = await start();
      expect(started.status).toBe(201);
      const startBody = (await started.json()) as { activityId: string };
      expect(startBody).toMatchObject({
        ok: true,
        sequence: 0,
        status: "active",
        accepted: 1,
        failed: 0,
        // An omitted style stores the schema default.
        state: { accentColor: "#FF9F0A", progress: 0, style: "standard" },
        expiresAt: "2026-07-25T20:00:00.000Z",
        staleAt: "2026-07-25T16:00:00.000Z",
      });
      expect(apnsCalls.at(-1)).toMatchObject({
        environment: "sandbox",
        priority: 10,
        input: {
          event: "start",
          staleDate: 1_784_995_200,
          props: { activityId: startBody.activityId, accentColor: "#FF9F0A", style: "standard" },
          attributes: {
            tokenRegistrationURL: "http://localhost:5173/api/live-activity/update-token",
          },
        },
      });

      const updateToken = "bb".repeat(32);
      const startCall = apnsCalls.at(-1);
      if (!startCall) throw new Error("Expected a Live Activity start call");
      const attributes = (
        startCall.input as {
          attributes: { deliveryId: string; tokenRegistrationToken: string };
        }
      ).attributes;
      const wrongRegistrationToken = `${attributes.tokenRegistrationToken.slice(0, -1)}${
        attributes.tokenRegistrationToken.endsWith("A") ? "B" : "A"
      }`;
      authState.userId = null;
      const invalidRegistration = await app.request("/api/live-activity/update-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deliveryId: attributes.deliveryId,
          registrationToken: wrongRegistrationToken,
          nativeActivityId: "native-background",
          updateToken,
        }),
      });
      expect(invalidRegistration.status).toBe(404);
      expect(
        (
          await app.request("/api/live-activity/update-token", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              deliveryId: attributes.deliveryId,
              registrationToken: attributes.tokenRegistrationToken,
              nativeActivityId: "native-background",
              updateToken,
            }),
          })
        ).status,
      ).toBe(200);

      vi.setSystemTime(new Date("2026-07-25T13:00:00.000Z"));
      const updated = await activityRequest(
        TOKEN,
        `/${startBody.activityId}`,
        "PATCH",
        {
          status: "Testing",
          progress: 0.5,
          accentColor: "#64D2FF",
          style: "terminal",
          ifSequence: 0,
        },
        "deploy-update-1",
      );
      expect(await updated.json()).toMatchObject({
        ok: true,
        activityId: startBody.activityId,
        sequence: 1,
        // Updates switch the layout mid-flight, exactly like symbol or accentColor.
        state: { status: "Testing", progress: 0.5, accentColor: "#64D2FF", style: "terminal" },
        staleAt: "2026-07-25T17:00:00.000Z",
      });
      expect(apnsCalls.at(-1)).toMatchObject({
        token: updateToken,
        priority: 10,
        input: { event: "update", staleDate: 1_784_998_800 },
      });

      const read = await activityRequest(TOKEN, `/${startBody.activityId}`, "GET");
      expect(await read.json()).toMatchObject({
        ok: true,
        activityId: startBody.activityId,
        sequence: 1,
      });

      const ended = await activityRequest(TOKEN, `/${startBody.activityId}/end`, "POST", {
        status: "Deployed",
        progress: 1,
        symbol: "success",
        accentColor: "#5ED8B7",
        dismissAfterSeconds: 30,
        ifSequence: 1,
      });
      expect(await ended.json()).toMatchObject({
        ok: true,
        activityId: startBody.activityId,
        sequence: 2,
        status: "ended",
        // Operations that omit style leave the stored value unchanged.
        state: { status: "Deployed", progress: 1, accentColor: "#5ED8B7", style: "terminal" },
      });
      expect(apnsCalls.at(-1)).toMatchObject({
        priority: 10,
        input: { event: "end", dismissalDate: 1_784_984_430 },
      });
      expect(
        (
          await app.request("/api/live-activity/update-token", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              deliveryId: attributes.deliveryId,
              registrationToken: attributes.tokenRegistrationToken,
              nativeActivityId: "native-background",
              updateToken: "cc".repeat(32),
            }),
          })
        ).status,
      ).toBe(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent and enforces one active activity per device", async () => {
    const first = await start(TOKEN, "deploy-start");
    const firstBody = (await first.json()) as { activityId: string };
    const replay = await start(TOKEN, "deploy-start");
    expect(await replay.json()).toMatchObject({
      ok: true,
      activityId: firstBody.activityId,
      idempotent: true,
    });
    expect(apnsCalls).toHaveLength(1);

    const conflict = await start();
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      ok: false,
      code: "ACTIVE_ACTIVITY_CONFLICT",
      activityId: firstBody.activityId,
    });
  });

  it("replaces the blocking activity when replace is true", async () => {
    const first = await start();
    const firstBody = (await first.json()) as { activityId: string };
    const registered = await app.request("/api/devices/live-activity/update-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "hook_activity_device",
        activityId: firstBody.activityId,
        nativeActivityId: "native-replace",
        updateToken: "dd".repeat(32),
        environment: "sandbox",
        schemaVersion: 1,
      }),
    });
    expect(registered.status).toBe(200);

    apnsCalls.length = 0;
    const second = await activityRequest(TOKEN, "", "POST", {
      title: "Deploy #185",
      status: "Building",
      replace: true,
      deviceIds: ["hook_activity_device"],
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { activityId: string };
    expect(secondBody).toMatchObject({ ok: true, replaced: 1, status: "active", accepted: 1 });

    expect(apnsCalls).toHaveLength(2);
    expect(apnsCalls[0]).toMatchObject({
      token: "dd".repeat(32),
      priority: 10,
      input: { event: "end", props: { activityId: firstBody.activityId, title: "Deploy #184" } },
    });
    const endPush = apnsCalls[0];
    if (!endPush) throw new Error("Expected an implicit end push");
    expect((endPush.input as { dismissalDate?: number }).dismissalDate).toBeTypeOf("number");
    expect(apnsCalls[1]).toMatchObject({
      input: { event: "start", props: { activityId: secondBody.activityId } },
    });

    const { eq } = await import("drizzle-orm");
    const oldActivity = db
      .select()
      .from(schema.liveActivity)
      .where(eq(schema.liveActivity.id, firstBody.activityId))
      .get();
    expect(oldActivity).toMatchObject({ status: "ended" });
    expect(oldActivity?.endedAt).not.toBeNull();
    const oldDelivery = db
      .select()
      .from(schema.liveActivityDelivery)
      .where(eq(schema.liveActivityDelivery.activityId, firstBody.activityId))
      .get();
    expect(oldDelivery).toMatchObject({ status: "ended", lastEvent: "end" });
  });

  it("replaces a blocker owned by another service without disclosing it", async () => {
    const foreign = await start(OTHER_TOKEN);
    const foreignBody = (await foreign.json()) as { activityId: string };

    const second = await activityRequest(TOKEN, "", "POST", {
      title: "Deploy #185",
      status: "Building",
      replace: true,
      deviceIds: ["hook_activity_device"],
    });
    expect(second.status).toBe(201);
    const raw = await second.text();
    expect(raw).not.toContain(foreignBody.activityId);
    expect(JSON.parse(raw)).toMatchObject({ ok: true, replaced: 1, accepted: 1 });

    const { eq } = await import("drizzle-orm");
    const displaced = db
      .select()
      .from(schema.liveActivity)
      .where(eq(schema.liveActivity.id, foreignBody.activityId))
      .get();
    expect(displaced).toMatchObject({ status: "ended" });
  });

  it("starts normally with replaced 0 when replace finds no conflict", async () => {
    const response = await activityRequest(TOKEN, "", "POST", {
      title: "Deploy #186",
      status: "Building",
      replace: true,
      deviceIds: ["hook_activity_device"],
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, replaced: 0, accepted: 1 });
  });

  it("frees a key once its activity ends and lets replace displace the keyed run", async () => {
    const keyedStart = () =>
      activityRequest(TOKEN, "", "POST", {
        title: "Deploy",
        status: "Building",
        key: "deploy",
        deviceIds: ["hook_activity_device"],
      });
    const first = await keyedStart();
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { activityId: string };
    expect((await activityRequest(TOKEN, "/deploy/end", "POST", {})).status).toBe(200);

    const second = await keyedStart();
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { activityId: string };
    expect(secondBody.activityId).not.toBe(firstBody.activityId);

    const third = await activityRequest(TOKEN, "", "POST", {
      title: "Deploy",
      status: "Building",
      key: "deploy",
      replace: true,
      deviceIds: ["hook_activity_device"],
    });
    expect(third.status).toBe(201);
    const thirdBody = (await third.json()) as { activityId: string };
    expect(thirdBody).toMatchObject({ replaced: 1 });

    const read = await activityRequest(TOKEN, "/deploy", "GET");
    expect(await read.json()).toMatchObject({
      activityId: thirdBody.activityId,
      status: "active",
    });

    const { eq } = await import("drizzle-orm");
    const displaced = db
      .select()
      .from(schema.liveActivity)
      .where(eq(schema.liveActivity.id, secondBody.activityId))
      .get();
    expect(displaced).toMatchObject({ status: "ended" });
  });

  it("takes over a key whose activity no longer occupies a device", async () => {
    const first = await activityRequest(TOKEN, "", "POST", {
      title: "Deploy",
      status: "Building",
      key: "deploy",
      deviceIds: ["hook_activity_device"],
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { activityId: string };

    // Simulate a delivery that died (rejected push, device transfer) while
    // the activity stayed live: the device slot is free, the key is not.
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.liveActivityDelivery)
      .set({ status: "failed", updateTokenCiphertext: null })
      .where(eq(schema.liveActivityDelivery.activityId, firstBody.activityId));

    const blocked = await activityRequest(TOKEN, "", "POST", {
      title: "Deploy",
      status: "Building",
      key: "deploy",
      deviceIds: ["hook_activity_device"],
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      code: "ACTIVE_ACTIVITY_CONFLICT",
      activityId: firstBody.activityId,
    });

    const replaceStart = await activityRequest(TOKEN, "", "POST", {
      title: "Deploy",
      status: "Building",
      key: "deploy",
      replace: true,
      deviceIds: ["hook_activity_device"],
    });
    expect(replaceStart.status).toBe(201);
    const replaceBody = (await replaceStart.json()) as { activityId: string };
    expect(replaceBody).toMatchObject({ ok: true, replaced: 1, accepted: 1 });

    const displaced = db
      .select()
      .from(schema.liveActivity)
      .where(eq(schema.liveActivity.id, firstBody.activityId))
      .get();
    expect(displaced).toMatchObject({ status: "ended" });

    const read = await activityRequest(TOKEN, "/deploy", "GET");
    expect(await read.json()).toMatchObject({
      activityId: replaceBody.activityId,
      status: "active",
    });
  });

  it("replays a replace start idempotently without ending anything twice", async () => {
    const first = await start();
    const firstBody = (await first.json()) as { activityId: string };
    const body = {
      title: "Deploy #185",
      status: "Building",
      replace: true,
      deviceIds: ["hook_activity_device"],
    };
    const initial = await activityRequest(TOKEN, "", "POST", body, "replace-once");
    expect(initial.status).toBe(201);
    const initialBody = (await initial.json()) as { activityId: string; replaced: number };
    expect(initialBody.replaced).toBe(1);

    const pushes = apnsCalls.length;
    const replay = await activityRequest(TOKEN, "", "POST", body, "replace-once");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      ok: true,
      activityId: initialBody.activityId,
      idempotent: true,
    });
    expect(apnsCalls).toHaveLength(pushes);

    const { eq } = await import("drizzle-orm");
    const current = db
      .select()
      .from(schema.liveActivity)
      .where(eq(schema.liveActivity.id, initialBody.activityId))
      .get();
    expect(current).toMatchObject({ status: "active" });
    const displaced = db
      .select()
      .from(schema.liveActivity)
      .where(eq(schema.liveActivity.id, firstBody.activityId))
      .get();
    expect(displaced).toMatchObject({ status: "ended" });
  });

  it("starts a Live Activity on the free plan", async () => {
    billingState.pro = false;
    const targeted = await start();
    expect(targeted.status).toBe(402);
    expect(await targeted.json()).toMatchObject({ error: "Device routing requires Hark Pro" });
    const response = await activityRequest(TOKEN, "", "POST", {
      title: "Deploy #184",
      status: "Building",
      progress: 0,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(apnsCalls.length).toBeGreaterThan(0);
  });

  it("keeps webhook services isolated", async () => {
    expect((await start("whk_unknown")).status).toBe(404);
    const created = await start();
    const body = (await created.json()) as { activityId: string };
    expect((await activityRequest(OTHER_TOKEN, `/${body.activityId}`, "GET")).status).toBe(404);
    expect(
      (
        await activityRequest(OTHER_TOKEN, `/${body.activityId}`, "PATCH", {
          status: "Hijacked",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await activityRequest(OTHER_TOKEN, `/${body.activityId}/end`, "POST", {
          status: "Hijacked",
        })
      ).status,
    ).toBe(404);
  });
});

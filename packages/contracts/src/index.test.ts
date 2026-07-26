import { describe, expect, it } from "vitest";
import {
  agentNotificationCreateSchema,
  deviceRegisterSchema,
  interactionCreateSchema,
  interactionResponseSchema,
  LIVE_ACTIVITY_SCHEMA_VERSION,
  liveActivityBackgroundTokenSchema,
  liveActivityEndSchema,
  liveActivityPropsSchema,
  liveActivityStartSchema,
  liveActivityUpdateSchema,
  pushDataSchema,
  serviceCreateSchema,
  webhookRequestSchema,
} from "./index";

describe("webhookRequestSchema", () => {
  it("accepts a minimal payload", () => {
    const result = webhookRequestSchema.safeParse({ body: "Deploy finished" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing body", () => {
    expect(webhookRequestSchema.safeParse({}).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "" }).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(webhookRequestSchema.safeParse({ body: "x", imageUrl: "not-a-url" }).success).toBe(
      false,
    );
    expect(webhookRequestSchema.safeParse({ body: "x", url: "also nope" }).success).toBe(false);
  });

  it("only accepts public HTTPS image URLs", () => {
    expect(
      webhookRequestSchema.safeParse({ body: "x", imageUrl: "http://example.com/a.png" }).success,
    ).toBe(false);
    expect(
      webhookRequestSchema.safeParse({ body: "x", imageUrl: "https://127.0.0.1/a.png" }).success,
    ).toBe(false);
    expect(
      webhookRequestSchema.safeParse({ body: "x", imageUrl: "https://192.168.1.8/a.png" }).success,
    ).toBe(false);
    expect(
      webhookRequestSchema.safeParse({ body: "x", imageUrl: "https://example.com/a.png" }).success,
    ).toBe(true);
  });

  it("only accepts http and https tap destinations", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "hark://open",
    ]) {
      expect(webhookRequestSchema.safeParse({ body: "x", url }).success).toBe(false);
    }
    expect(webhookRequestSchema.safeParse({ body: "x", url: "http://example.com" }).success).toBe(
      true,
    );
    expect(webhookRequestSchema.safeParse({ body: "x", url: "https://example.com" }).success).toBe(
      true,
    );
  });

  it("rejects image URLs on mapped and carrier-grade private ranges", () => {
    for (const imageUrl of [
      "https://[::ffff:127.0.0.1]/a.png",
      "https://100.64.0.1/a.png",
      "https://192.0.0.1/a.png",
      "https://198.18.0.1/a.png",
    ]) {
      expect(webhookRequestSchema.safeParse({ body: "x", imageUrl }).success).toBe(false);
    }
  });

  it("accepts full overrides", () => {
    const result = webhookRequestSchema.safeParse({
      body: "3 new sign-ups",
      title: "Acme CRM",
      imageUrl: "https://example.com/logo.png",
      url: "https://example.com/dashboard",
    });
    expect(result.success).toBe(true);
  });

  it("normalizes device routing targets for stable idempotency", () => {
    const result = webhookRequestSchema.safeParse({
      body: "Targeted",
      deviceIds: ["dev_b", "dev_a", "dev_b"],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.deviceIds).toEqual(["dev_a", "dev_b"]);
  });

  it("rejects an empty device routing list", () => {
    expect(webhookRequestSchema.safeParse({ body: "Targeted", deviceIds: [] }).success).toBe(false);
  });

  it("accepts fixed interactive response types and validates callbacks", () => {
    expect(
      webhookRequestSchema.parse({
        body: "Deploy?",
        response: {
          type: "approval",
          callback: { url: "https://ci.example.com/hark", token: "x".repeat(32) },
        },
      }).response,
    ).toMatchObject({ type: "approval", expiresInSeconds: 900 });
    expect(
      webhookRequestSchema.safeParse({ body: "Reply?", response: { type: "text" } }).success,
    ).toBe(true);
    expect(
      webhookRequestSchema.safeParse({ body: "No", response: { type: "custom" } }).success,
    ).toBe(false);
    expect(
      webhookRequestSchema.safeParse({
        body: "No",
        response: {
          type: "yes_no",
          callback: { url: "http://localhost/callback", token: "x".repeat(32) },
        },
      }).success,
    ).toBe(false);
  });
});

describe("agentNotificationCreateSchema", () => {
  it("accepts one-shot notification fields but not interaction responses", () => {
    expect(
      agentNotificationCreateSchema.safeParse({
        body: "Tests passed",
        title: "Mux",
        url: "https://example.com/build/123",
        imageUrl: "https://example.com/mux.png",
        deviceIds: ["dev_b", "dev_a", "dev_b"],
      }),
    ).toMatchObject({
      success: true,
      data: { deviceIds: ["dev_a", "dev_b"] },
    });
    expect(
      agentNotificationCreateSchema.safeParse({
        body: "Deploy?",
        response: { type: "approval" },
      }).success,
    ).toBe(false);
  });
});

describe("interaction schemas", () => {
  it("normalizes targets and supplies a conservative expiry", () => {
    const result = interactionCreateSchema.safeParse({
      title: "Release",
      prompt: "Deploy?",
      kind: "approval",
      deviceIds: ["dev_b", "dev_a", "dev_b"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deviceIds).toEqual(["dev_a", "dev_b"]);
      expect(result.data.expiresInSeconds).toBe(900);
    }
  });

  it("requires text only for reply actions", () => {
    const actionDigest = "a".repeat(64);
    expect(
      interactionResponseSchema.safeParse({ action: "approve", deviceId: "dev_1", actionDigest })
        .success,
    ).toBe(true);
    expect(
      interactionResponseSchema.safeParse({
        action: "reply",
        response: "",
        deviceId: "dev_1",
        actionDigest,
      }).success,
    ).toBe(false);
    expect(
      interactionResponseSchema.safeParse({
        action: "reply",
        response: "Ship tomorrow",
        deviceId: "dev_1",
        actionDigest,
      }).success,
    ).toBe(true);
  });
});

describe("Live Activity schemas", () => {
  it("accepts the fixed Hark schema and bounds progress", () => {
    const props = {
      schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
      activityId: "act_1",
      title: "Build release",
      status: "Running tests",
      detail: "Workspace checks",
      progress: 0.42,
      updatedAt: new Date().toISOString(),
      symbol: "build",
      privacyMode: "standard",
    };
    expect(liveActivityPropsSchema.safeParse(props).success).toBe(true);
    expect(liveActivityPropsSchema.safeParse({ ...props, progress: 1.01 }).success).toBe(false);
    expect(liveActivityPropsSchema.safeParse({ ...props, schemaVersion: 2 }).success).toBe(false);
  });

  it("normalizes start targets and requires a meaningful update", () => {
    const start = liveActivityStartSchema.parse({
      title: "Task",
      status: "Starting",
      deviceIds: ["dev_b", "dev_a", "dev_b"],
    });
    expect(start.deviceIds).toEqual(["dev_a", "dev_b"]);
    expect(start).toMatchObject({
      accentColor: "#5ED8B7",
      expiresInSeconds: 28_800,
      staleAfterSeconds: 14_400,
      replace: false,
    });
    expect(
      liveActivityStartSchema.safeParse({
        title: "Task",
        status: "Starting",
        accentColor: "#aBc123",
      }).success,
    ).toBe(true);
    for (const accentColor of ["5ED8B7", "#fff", "#5ED8B7CC", "#GGGGGG"]) {
      expect(
        liveActivityStartSchema.safeParse({ title: "Task", status: "Starting", accentColor })
          .success,
      ).toBe(false);
    }
    expect(liveActivityUpdateSchema.safeParse({ ifSequence: 0 }).success).toBe(false);
    expect(liveActivityUpdateSchema.safeParse({ progress: null, ifSequence: 2 }).success).toBe(
      true,
    );
    expect(liveActivityEndSchema.parse({}).dismissAfterSeconds).toBe(0);
  });

  it("validates background update-token registration", () => {
    const input = {
      deliveryId: "lad_1",
      registrationToken: "a".repeat(43),
      nativeActivityId: "native_1",
      updateToken: "ab".repeat(32),
    };
    expect(liveActivityBackgroundTokenSchema.safeParse(input).success).toBe(true);
    expect(
      liveActivityBackgroundTokenSchema.safeParse({ ...input, registrationToken: "short" }).success,
    ).toBe(false);
  });
});

describe("serviceCreateSchema", () => {
  it("requires a title", () => {
    expect(serviceCreateSchema.safeParse({}).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ title: "CI Alerts" }).success).toBe(true);
  });

  it("allows nullable optional fields", () => {
    const result = serviceCreateSchema.safeParse({ title: "CI", imageUrl: null, url: null });
    expect(result.success).toBe(true);
  });
});

describe("deviceRegisterSchema", () => {
  it("constrains platform to ios", () => {
    expect(
      deviceRegisterSchema.safeParse({ expoPushToken: "ExponentPushToken[x]", platform: "ios" })
        .success,
    ).toBe(true);
    expect(
      deviceRegisterSchema.safeParse({
        expoPushToken: "ExponentPushToken[x]",
        platform: "android",
      }).success,
    ).toBe(false);
  });
});

describe("pushDataSchema", () => {
  it("round-trips a full payload", () => {
    const result = pushDataSchema.safeParse({
      v: 1,
      eventId: "evt_1",
      serviceId: "svc_1",
      sourceId: "svc_1",
      sourceName: "Acme CRM",
      avatarUrl: "https://example.com/a.png",
      url: "https://example.com",
      conversationId: "hark-svc_1",
    });
    expect(result.success).toBe(true);
  });
});

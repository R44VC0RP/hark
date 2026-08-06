import { describe, expect, it } from "vitest";
import {
  agentNotificationCreateSchema,
  appleNativeTokenExchangeSchema,
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

describe("appleNativeTokenExchangeSchema", () => {
  it("requires both bounded Apple credentials", () => {
    expect(
      appleNativeTokenExchangeSchema.safeParse({
        authorizationCode: "single-use-code",
        identityToken: "identity-token",
      }).success,
    ).toBe(true);
    expect(appleNativeTokenExchangeSchema.safeParse({ authorizationCode: "code" }).success).toBe(
      false,
    );
    expect(
      appleNativeTokenExchangeSchema.safeParse({
        authorizationCode: "x".repeat(4097),
        identityToken: "token",
      }).success,
    ).toBe(false);
  });
});

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
  it("defaults the title and normalizes device targets", () => {
    const result = agentNotificationCreateSchema.safeParse({
      body: "Deploy finished",
      deviceIds: ["dev_b", "dev_a", "dev_b"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Hark");
      expect(result.data.deviceIds).toEqual(["dev_a", "dev_b"]);
    }
  });

  it("only accepts public HTTPS image URLs and web tap URLs", () => {
    expect(agentNotificationCreateSchema.safeParse({ body: "" }).success).toBe(false);
    expect(
      agentNotificationCreateSchema.safeParse({ body: "x", imageUrl: "http://example.com/a.png" })
        .success,
    ).toBe(false);
    expect(
      agentNotificationCreateSchema.safeParse({ body: "x", imageUrl: "https://localhost/a.png" })
        .success,
    ).toBe(false);
    expect(
      agentNotificationCreateSchema.safeParse({ body: "x", url: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      agentNotificationCreateSchema.safeParse({
        body: "x",
        imageUrl: "https://example.com/a.png",
        url: "https://example.com/run",
      }).success,
    ).toBe(true);
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
      expect(result.data.presentation).toBeUndefined();
    }
  });

  it("validates interactive Live Activity requests and cosmetic labels", () => {
    const valid = interactionCreateSchema.safeParse({
      title: "Release",
      prompt: "Send the prepared release email?",
      kind: "approval",
      presentation: "live_activity",
      style: "signal",
      primaryLabel: "Send",
      secondaryLabel: "Deny",
      expiresInSeconds: 900,
    });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.style).toBe("signal");
    for (const invalid of [
      {
        title: "Reply",
        prompt: "Type a response",
        kind: "reply",
        presentation: "live_activity",
      },
      {
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        primaryLabel: "Deploy",
      },
      {
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        style: "signal",
      },
      {
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        presentation: "live_activity",
        style: "neon",
      },
      {
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        presentation: "live_activity",
        expiresInSeconds: 28_801,
      },
      {
        title: "Release",
        prompt: "x".repeat(241),
        kind: "approval",
        presentation: "live_activity",
      },
      {
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        presentation: "live_activity",
        primaryLabel: "Deploy\nnow",
      },
    ]) {
      expect(interactionCreateSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("accepts only public HTTPS interaction images", () => {
    expect(
      interactionCreateSchema.safeParse({
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        imageUrl: "https://example.com/avatar.png",
      }).success,
    ).toBe(true);
    expect(
      interactionCreateSchema.safeParse({
        title: "Release",
        prompt: "Deploy?",
        kind: "approval",
        imageUrl: "https://10.0.0.2/avatar.png",
      }).success,
    ).toBe(false);
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

  it("keeps style optional in props but defaulted on start", () => {
    const props = {
      schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
      activityId: "act_1",
      title: "Build release",
      status: "Running tests",
      updatedAt: new Date().toISOString(),
      symbol: "build",
      privacyMode: "standard",
    };
    // Payloads written before the field existed must keep validating.
    expect(liveActivityPropsSchema.safeParse(props).success).toBe(true);
    expect(liveActivityPropsSchema.safeParse({ ...props, style: "ring" }).success).toBe(true);
    expect(liveActivityPropsSchema.safeParse({ ...props, style: "neon" }).success).toBe(false);
    expect(liveActivityPropsSchema.safeParse({ ...props, style: "approval" }).success).toBe(false);
    for (const style of ["shell", "verdict", "signal"] as const) {
      expect(liveActivityPropsSchema.safeParse({ ...props, style }).success).toBe(false);
    }
    expect(
      liveActivityPropsSchema.safeParse({
        ...props,
        style: "approval",
        interaction: {
          id: "int_1",
          kind: "approval",
          prompt: "Deploy?",
          primaryLabel: "Deploy",
          secondaryLabel: "Deny",
          primaryAction: "approve",
          secondaryAction: "deny",
          state: "pending",
        },
      }).success,
    ).toBe(true);
    for (const style of ["shell", "verdict", "signal"] as const) {
      expect(
        liveActivityPropsSchema.safeParse({
          ...props,
          style,
          interaction: {
            id: "int_1",
            kind: "approval",
            prompt: "Deploy?",
            primaryLabel: "Deploy",
            secondaryLabel: "Deny",
            primaryAction: "approve",
            secondaryAction: "deny",
            state: "pending",
          },
        }).success,
      ).toBe(true);
    }
    expect(
      liveActivityPropsSchema.safeParse({
        ...props,
        style: "approval",
        interaction: {
          id: "int_1",
          kind: "approval",
          prompt: "Deploy?",
          primaryLabel: "Deploy",
          secondaryLabel: "Deny",
          primaryAction: "yes",
          secondaryAction: "no",
          state: "pending",
        },
      }).success,
    ).toBe(false);

    expect(liveActivityStartSchema.parse({ title: "Task", status: "Starting" }).style).toBe(
      "standard",
    );
    expect(
      liveActivityStartSchema.parse({ title: "Task", status: "Starting", style: "hero" }).style,
    ).toBe("hero");
    expect(
      liveActivityStartSchema.safeParse({ title: "Task", status: "Starting", style: "neon" })
        .success,
    ).toBe(false);
    expect(
      liveActivityStartSchema.safeParse({ title: "Task", status: "Starting", style: "signal" })
        .success,
    ).toBe(false);

    // Updates accept a style change and it counts as a meaningful field.
    expect(liveActivityUpdateSchema.safeParse({ style: "steps" }).success).toBe(true);
    expect(liveActivityUpdateSchema.safeParse({ style: "approval" }).success).toBe(false);
    expect(liveActivityUpdateSchema.safeParse({ style: "signal" }).success).toBe(false);
    expect(liveActivityUpdateSchema.safeParse({ style: "neon" }).success).toBe(false);
    expect(liveActivityUpdateSchema.parse({ style: "terminal" }).style).toBe("terminal");
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

  it("accepts a notification withdrawal command", () => {
    expect(
      pushDataSchema.safeParse({
        v: 1,
        command: "notification.withdraw",
        eventId: "evt_1",
      }).success,
    ).toBe(true);
  });
});

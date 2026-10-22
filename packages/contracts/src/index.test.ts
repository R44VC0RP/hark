import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  API_TOKEN_SCOPE_DESCRIPTIONS,
  API_TOKEN_SCOPES,
  agentNotificationCreateSchema,
  appleNativeTokenExchangeSchema,
  deviceRegisterSchema,
  inboxMarkAllReadSchema,
  interactionCreateSchema,
  interactionResponseSchema,
  LIVE_ACTIVITY_SCHEMA_VERSION,
  liveActivityBackgroundTokenSchema,
  liveActivityEndSchema,
  liveActivityPropsSchema,
  liveActivityStartSchema,
  liveActivityUpdateSchema,
  NOTIFICATION_BODY_MAX_CHARS,
  normalizeProjectName,
  OAUTH_DEFAULT_SCOPES,
  OAUTH_SCOPES,
  pushDataSchema,
  serviceCreateSchema,
  truncateToUtf8Bytes,
  utf8ByteLength,
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

  it("accepts web and app-link tap destinations while blocking unsafe schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "blob:https://example.com/id",
      "about:blank",
      "hark://inbox/evt_1",
      "HARK://web/app_12345678?url=/x",
      "ceo.ryan.hark://notification/evt_1",
      "exp+hark://expo-development-client/?url=http://10.0.0.1:8081",
      "exp://192.168.1.2:8081",
      "exps://u.expo.dev/x",
      "myapp://expo-development-client/?url=http://10.0.0.1:8081",
      "itms-services://?action=download-manifest&url=https://example.com/m.plist",
      "App-prefs:root=General",
      "prefs:root=WIFI",
    ]) {
      expect(webhookRequestSchema.safeParse({ body: "x", url }).success).toBe(false);
    }
    for (const url of [
      "http://example.com",
      "https://example.com",
      "tel:+15555550100",
      "sms:+15555550100",
      "mailto:ops@example.com",
      "linear://issue/ENG-1",
      "shortcuts://run-shortcut?name=Deploy%20Finished&input=text&text=production",
    ]) {
      expect(webhookRequestSchema.safeParse({ body: "x", url }).success).toBe(true);
    }
  });

  it("rejects image URLs on mapped and carrier-grade private ranges", () => {
    for (const imageUrl of [
      "https://[::ffff:127.0.0.1]/a.png",
      "https://100.64.0.1/a.png",
      "https://192.0.0.1/a.png",
      "https://198.18.0.1/a.png",
      "https://localhost./a.png",
      "https://app.localhost./a.png",
      "https://metadata.google.internal/a.png",
      "https://[::]/a.png",
      "https://[::1]/a.png",
      "https://[::7f00:1]/a.png",
      "https://[64:ff9b::7f00:1]/a.png",
      "https://[64:ff9b:1::a00:1]/a.png",
      "https://[fe80::1]/a.png",
      "https://0x7f000001/a.png",
      "https://2130706433/a.png",
      "https://169.254.169.254./a.png",
    ]) {
      expect(webhookRequestSchema.safeParse({ body: "x", imageUrl }).success).toBe(false);
    }
    for (const imageUrl of [
      "https://example.com./a.png",
      "https://fcbarcelona.example/a.png",
      "https://[2606:4700::1111]/a.png",
    ]) {
      expect(webhookRequestSchema.safeParse({ body: "x", imageUrl }).success).toBe(true);
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

  it("accepts the raised body capacity while enforcing the UTF-8 byte cap", () => {
    expect(
      webhookRequestSchema.safeParse({ body: "x".repeat(NOTIFICATION_BODY_MAX_CHARS) }).success,
    ).toBe(true);
    expect(
      webhookRequestSchema.safeParse({ body: "x".repeat(NOTIFICATION_BODY_MAX_CHARS + 1) }).success,
    ).toBe(false);
    // 6,000 characters of a 3-byte glyph is 18,000 bytes: over the byte cap.
    expect(webhookRequestSchema.safeParse({ body: "気".repeat(6_000) }).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "気".repeat(5_000) }).success).toBe(true);
  });

  it("keeps interactive bodies within the unchanged prompt limit", () => {
    const long = "x".repeat(2_001);
    expect(webhookRequestSchema.safeParse({ body: long }).success).toBe(true);
    expect(
      webhookRequestSchema.safeParse({ body: long, response: { type: "approval" } }).success,
    ).toBe(false);
    expect(
      webhookRequestSchema.safeParse({
        body: "x".repeat(2_000),
        response: { type: "approval" },
      }).success,
    ).toBe(true);
  });

  it("accepts optional project, summary, and bodyFormat metadata", () => {
    const result = webhookRequestSchema.safeParse({
      body: "Deploy finished",
      project: "Acme App",
      summary: "Deploy finished",
      bodyFormat: "markdown",
    });
    expect(result.success).toBe(true);
    expect(webhookRequestSchema.safeParse({ body: "x", bodyFormat: "html" }).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "x", project: "" }).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "x", project: "a\nb" }).success).toBe(false);
    expect(webhookRequestSchema.safeParse({ body: "x", project: "p".repeat(81) }).success).toBe(
      false,
    );
    expect(webhookRequestSchema.safeParse({ body: "x", summary: "s".repeat(501) }).success).toBe(
      false,
    );
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

  it("only accepts public HTTPS image URLs and safe tap destinations", () => {
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
        url: "linear://issue/ENG-1",
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

  it("accepts a custom app deep link as the default destination", () => {
    expect(
      serviceCreateSchema.safeParse({ title: "CI", url: "example-app://builds/48" }).success,
    ).toBe(true);
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
      url: "linear://issue/ENG-1",
      conversationId: "hark-svc_1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unsafe destination from a legacy or forged push", () => {
    const result = pushDataSchema.safeParse({
      v: 1,
      eventId: "evt_1",
      serviceId: "svc_1",
      sourceId: "svc_1",
      sourceName: "Acme CRM",
      url: "javascript:alert(1)",
      conversationId: "hark-svc_1",
    });
    expect(result.success).toBe(false);
  });

  it("carries an optional project association that legacy payloads omit", () => {
    const legacy = {
      v: 1,
      eventId: "evt_1",
      serviceId: "svc_1",
      sourceId: "svc_1",
      sourceName: "Acme CRM",
      conversationId: "hark-svc_1",
    };
    expect(pushDataSchema.safeParse(legacy).success).toBe(true);
    expect(pushDataSchema.safeParse({ ...legacy, projectId: "prj_1" }).success).toBe(true);
  });

  it("accepts only versioned notification withdrawal commands", () => {
    expect(
      pushDataSchema.safeParse({
        v: 1,
        command: "notification.withdraw",
        eventId: "evt_1",
      }).success,
    ).toBe(true);
    expect(
      pushDataSchema.safeParse({
        v: 2,
        command: "notification.withdraw",
        eventId: "evt_1",
      }).success,
    ).toBe(false);
  });
});

describe("UTF-8 helpers", () => {
  it("counts bytes exactly like UTF-8 encoding", () => {
    for (const sample of [
      "",
      "plain ascii",
      "naïve café",
      "気配りのできる",
      "🚀🔥👩‍👩‍👧‍👦",
      "a".repeat(9000),
    ]) {
      expect(utf8ByteLength(sample)).toBe(Buffer.byteLength(sample, "utf8"));
    }
  });

  it("truncates on code-point boundaries without splitting surrogate pairs", () => {
    expect(truncateToUtf8Bytes("abc", 10)).toBe("abc");
    expect(truncateToUtf8Bytes("abcdef", 3)).toBe("abc");
    expect(truncateToUtf8Bytes("🚀🚀", 5)).toBe("🚀");
    expect(truncateToUtf8Bytes("🚀🚀", 3)).toBe("");
    expect(truncateToUtf8Bytes("気配り", 7)).toBe("気配");
    expect(truncateToUtf8Bytes("anything", 0)).toBe("");
    // Every truncation is itself valid UTF-8 of bounded size.
    for (let budget = 0; budget <= 12; budget += 1) {
      const cut = truncateToUtf8Bytes("aé気🚀aé気🚀", budget);
      expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(budget);
      expect(cut.includes("\uFFFD")).toBe(false);
    }
  });
});

describe("project name normalization", () => {
  it("is case-insensitive and NFC-normalized", () => {
    expect(normalizeProjectName("Acme App")).toBe("acme app");
    // U+0065 U+0301 (e + combining acute) folds into U+00E9 (é).
    expect(normalizeProjectName("Cafe\u0301")).toBe(normalizeProjectName("Café"));
    expect(normalizeProjectName("ÄPFEL")).toBe("äpfel");
  });
});

describe("inboxMarkAllReadSchema", () => {
  it("requires an opaque read-through token and accepts an optional project filter", () => {
    expect(inboxMarkAllReadSchema.safeParse({}).success).toBe(false);
    expect(inboxMarkAllReadSchema.safeParse({ readThrough: "" }).success).toBe(false);
    expect(inboxMarkAllReadSchema.safeParse({ readThrough: "x".repeat(201) }).success).toBe(false);
    // The retired timestamp boundary alone is no longer a valid request.
    expect(inboxMarkAllReadSchema.safeParse({ before: "2026-08-09T12:00:00.000Z" }).success).toBe(
      false,
    );
    const parsed = inboxMarkAllReadSchema.safeParse({
      readThrough: "cnQxOjQyOjc",
      project: "unfiled",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("cross-deploy request-hash stability", () => {
  function hash(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  it("keeps parsed webhook payloads and hashes identical to the pre-project schema", () => {
    // Serialized forms produced by the schema that shipped before projects
    // existed. If any fixture changes, replayed Idempotency-Key requests from
    // an old deploy would 409 against rows written by a new deploy.
    const fixtures: Array<{ input: unknown; expected: string }> = [
      { input: { body: "Deploy finished" }, expected: '{"body":"Deploy finished"}' },
      {
        input: { title: "CI", body: "Build failed", url: "https://example.com/build/1" },
        expected: '{"body":"Build failed","title":"CI","url":"https://example.com/build/1"}',
      },
      {
        input: { body: "Targeted", deviceIds: ["dev_b", "dev_a", "dev_b"] },
        expected: '{"body":"Targeted","deviceIds":["dev_a","dev_b"]}',
      },
      {
        input: { body: "Deploy?", response: { type: "approval", correlationId: "deploy-1" } },
        expected:
          '{"body":"Deploy?","response":{"type":"approval","expiresInSeconds":900,"correlationId":"deploy-1"}}',
      },
    ];
    for (const fixture of fixtures) {
      const parsed = webhookRequestSchema.parse(fixture.input);
      expect(JSON.stringify(parsed)).toBe(fixture.expected);
      expect(hash(parsed)).toBe(hash(JSON.parse(fixture.expected)));
    }
  });

  it("keeps parsed agent notification payloads identical to the pre-project schema", () => {
    const fixtures: Array<{ input: unknown; expected: string }> = [
      { input: { body: "Done" }, expected: '{"body":"Done","title":"Hark"}' },
      {
        input: { body: "Done", title: "Deploybot", imageUrl: "https://example.com/a.png" },
        expected: '{"body":"Done","title":"Deploybot","imageUrl":"https://example.com/a.png"}',
      },
    ];
    for (const fixture of fixtures) {
      const parsed = agentNotificationCreateSchema.parse(fixture.input);
      expect(JSON.stringify(parsed)).toBe(fixture.expected);
    }
  });

  it("appends new optional fields after every legacy key", () => {
    const parsed = webhookRequestSchema.parse({
      project: "Acme",
      body: "x",
      title: "T",
      summary: "s",
    });
    expect(JSON.stringify(parsed)).toBe('{"body":"x","title":"T","project":"Acme","summary":"s"}');
  });
});

describe("OAuth scopes", () => {
  it("map 1:1 to API token scopes plus offline_access", () => {
    expect(OAUTH_SCOPES).toEqual([...API_TOKEN_SCOPES, "offline_access"]);
    expect(Object.keys(API_TOKEN_SCOPE_DESCRIPTIONS).sort()).toEqual([...API_TOKEN_SCOPES].sort());
  });

  it("default to everything except tokens:manage", () => {
    expect(OAUTH_DEFAULT_SCOPES).not.toContain("tokens:manage");
    expect(OAUTH_DEFAULT_SCOPES).toContain("offline_access");
    expect(OAUTH_DEFAULT_SCOPES).toHaveLength(OAUTH_SCOPES.length - 1);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildInteractionPushMessages,
  buildNotificationWithdrawalPushMessages,
  buildPushMessages,
  buildWelcomePushMessages,
  resolveNotification,
} from "./push";

const service = {
  title: "Acme CRM",
  imageUrl: "https://example.com/default.png",
  url: "https://example.com/app",
};

describe("buildWelcomePushMessages", () => {
  it("builds Ryan's three-message onboarding sequence", () => {
    const messages = buildWelcomePushMessages("ExponentPushToken[a]");
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      to: "ExponentPushToken[a]",
      title: "Ryan",
      body: "hey! my name is ryan and I made hark!",
      priority: "high",
      mutableContent: true,
      richContent: {
        image: "https://pbs.twimg.com/profile_images/2070959207273082880/HZoVBuA2_400x400.jpg",
      },
      data: {
        v: 1,
        sourceId: "ryan",
        sourceName: "Ryan",
        avatarUrl: "https://pbs.twimg.com/profile_images/2070959207273082880/HZoVBuA2_400x400.jpg",
        url: "https://x.com/ryanvogel",
        conversationId: "hark-welcome-ryan",
      },
    });
    expect(messages[1]).toMatchObject({
      body: "easily send notifications via a webhook",
      data: { url: "https://hark.fyi" },
    });
    expect(messages[2]).toMatchObject({
      body: "get started here (click me)",
      data: { url: "https://hark.fyi" },
    });
  });
});

describe("buildNotificationWithdrawalPushMessages", () => {
  it("builds data-only background commands for every device", () => {
    const messages = buildNotificationWithdrawalPushMessages(
      ["ExponentPushToken[a]", "ExponentPushToken[b]"],
      "evt_1",
    );

    expect(messages).toEqual([
      {
        to: "ExponentPushToken[a]",
        data: { v: 1, command: "notification.withdraw", eventId: "evt_1" },
        _contentAvailable: true,
      },
      {
        to: "ExponentPushToken[b]",
        data: { v: 1, command: "notification.withdraw", eventId: "evt_1" },
        _contentAvailable: true,
      },
    ]);
    expect(messages.every((message) => !("title" in message) && !("body" in message))).toBe(true);
  });
});

describe("resolveNotification", () => {
  it("falls back to service defaults", () => {
    const resolved = resolveNotification(service, { body: "New sign-up" });
    expect(resolved).toEqual({
      title: "Acme CRM",
      body: "New sign-up",
      imageUrl: "https://example.com/default.png",
      url: "https://example.com/app",
    });
  });

  it("prefers webhook overrides", () => {
    const resolved = resolveNotification(service, {
      body: "Build failed",
      title: "CI",
      imageUrl: "https://example.com/ci.png",
      url: "https://example.com/build/1",
    });
    expect(resolved).toEqual({
      title: "CI",
      body: "Build failed",
      imageUrl: "https://example.com/ci.png",
      url: "https://example.com/build/1",
    });
  });

  it("omits image and url when neither side provides them", () => {
    const resolved = resolveNotification(
      { title: "Bare", imageUrl: null, url: null },
      { body: "hello" },
    );
    expect(resolved.imageUrl).toBeUndefined();
    expect(resolved.url).toBeUndefined();
  });
});

describe("buildInteractionPushMessages", () => {
  it("preserves fixed actionable categories and interaction metadata", () => {
    const [approval] = buildInteractionPushMessages({
      to: ["ExponentPushToken[a]"],
      interactionId: "int_1",
      kind: "approval",
      title: "Release",
      prompt: "Deploy production?",
      actionDigest: "a".repeat(64),
    });
    expect(approval).toMatchObject({
      categoryId: "HARK_APPROVAL_V1",
      title: "Release",
      body: "Deploy production?",
      data: {
        interactionId: "int_1",
        interactionKind: "approval",
        categoryId: "HARK_APPROVAL_V1",
        actionDigest: "a".repeat(64),
      },
    });

    const [reply] = buildInteractionPushMessages({
      to: ["ExponentPushToken[a]"],
      interactionId: "int_2",
      kind: "reply",
      title: "Release",
      prompt: "Release note?",
      actionDigest: "b".repeat(64),
    });
    expect(reply?.categoryId).toBe("HARK_REPLY_V1");
  });
});

describe("buildPushMessages", () => {
  const resolved = {
    title: "Acme CRM",
    body: "New sign-up",
    imageUrl: "https://example.com/a.png",
    url: "https://example.com/app",
  };

  it("builds one message per device with communication-notification fields", () => {
    const messages = buildPushMessages({
      to: ["ExponentPushToken[a]", "ExponentPushToken[b]"],
      eventId: "evt_1",
      serviceId: "svc_1",
      resolved,
    });

    expect(messages).toHaveLength(2);
    const [first] = messages;
    expect(first).toMatchObject({
      to: "ExponentPushToken[a]",
      title: "Acme CRM",
      body: "New sign-up",
      priority: "high",
      mutableContent: true,
      richContent: { image: "https://example.com/a.png" },
      data: {
        v: 1,
        eventId: "evt_1",
        serviceId: "svc_1",
        sourceId: "svc_1",
        sourceName: "Acme CRM",
        avatarUrl: "https://example.com/a.png",
        url: "https://example.com/app",
        conversationId: "hark-svc_1",
      },
    });
  });

  it("never leaks user identifiers or tokens in data", () => {
    const [message] = buildPushMessages({
      to: ["ExponentPushToken[a]"],
      eventId: "evt_1",
      serviceId: "svc_1",
      resolved,
    });
    const serialized = JSON.stringify(message?.data);
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("whk_");
  });

  it("omits richContent and avatarUrl without an image", () => {
    const [message] = buildPushMessages({
      to: ["ExponentPushToken[a]"],
      eventId: "evt_1",
      serviceId: "svc_1",
      resolved: { title: "T", body: "B" },
    });
    expect(message?.richContent).toBeUndefined();
    const data = (message?.data ?? {}) as Record<string, unknown>;
    expect(data.avatarUrl).toBeUndefined();
    expect("projectId" in data).toBe(false);
  });

  it("adds projectId to data only when a project is associated", () => {
    const [message] = buildPushMessages({
      to: ["ExponentPushToken[a]"],
      eventId: "evt_1",
      serviceId: "svc_1",
      projectId: "prj_1",
      resolved,
    });
    expect(((message?.data ?? {}) as Record<string, unknown>).projectId).toBe("prj_1");
  });

  it("prefers the sender summary over the body for push text", () => {
    const [message] = buildPushMessages({
      to: ["ExponentPushToken[a]"],
      eventId: "evt_1",
      serviceId: "svc_1",
      resolved: { title: "T", body: "x".repeat(7_000), summary: "Deploy finished: 3 services" },
    });
    expect(message?.body).toBe("Deploy finished: 3 services");
    expect(JSON.stringify(message).length).toBeLessThan(1_500);
  });

  it("byte-fits an oversized multibyte body instead of shipping it whole", () => {
    const [message] = buildPushMessages({
      to: ["ExponentPushToken[a]"],
      eventId: "evt_1",
      serviceId: "svc_1",
      resolved: { title: "T", body: "気配り🚀".repeat(1_500) },
    });
    expect(Buffer.byteLength(JSON.stringify(message), "utf8")).toBeLessThanOrEqual(4_096);
    expect(message?.body?.endsWith("…")).toBe(true);
  });

  it("byte-fits interaction prompts the same way", () => {
    const [message] = buildInteractionPushMessages({
      to: ["ExponentPushToken[a]"],
      interactionId: "int_1",
      kind: "approval",
      title: "Release",
      prompt: "🚀".repeat(1_990),
      actionDigest: "a".repeat(64),
      responseToken: "r".repeat(43),
      url: "https://example.com/deploy",
    });
    expect(Buffer.byteLength(JSON.stringify(message), "utf8")).toBeLessThanOrEqual(4_096);
    expect(message?.data).toMatchObject({ actionDigest: "a".repeat(64) });
  });

  it("keeps short bodies byte-identical to the previous builder output", () => {
    const [message] = buildPushMessages({
      to: ["ExponentPushToken[a]"],
      eventId: "evt_1",
      serviceId: "svc_1",
      resolved,
    });
    expect(JSON.stringify(message)).toBe(
      JSON.stringify({
        to: "ExponentPushToken[a]",
        title: "Acme CRM",
        body: "New sign-up",
        priority: "high",
        mutableContent: true,
        richContent: { image: "https://example.com/a.png" },
        data: {
          v: 1,
          eventId: "evt_1",
          serviceId: "svc_1",
          sourceId: "svc_1",
          sourceName: "Acme CRM",
          avatarUrl: "https://example.com/a.png",
          url: "https://example.com/app",
          conversationId: "hark-svc_1",
        },
      }),
    );
  });
});

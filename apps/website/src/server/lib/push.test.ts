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
      data: { url: "https://hark.ryan.ceo" },
    });
    expect(messages[2]).toMatchObject({
      body: "get started here (click me)",
      data: { url: "https://hark.ryan.ceo" },
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
  });
});

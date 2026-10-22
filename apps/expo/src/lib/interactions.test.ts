import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookie: "session" as string | undefined,
  store: new Map<string, string>(),
  submissions: [] as Array<{ id: string; input: Record<string, unknown> }>,
  pageAcks: [] as Array<{ id: string; responseToken?: string }>,
  pageAckError: undefined as unknown,
  submit: undefined as
    | ((id: string, input: Record<string, unknown>) => Promise<unknown>)
    | undefined,
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => state.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    state.store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    state.store.delete(key);
  },
}));

vi.mock("expo-notifications", () => ({
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  setNotificationCategoryAsync: vi.fn(),
}));

vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));

vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn(async () => undefined) },
  Alert: { alert: vi.fn() },
}));

vi.mock("./analytics", () => ({ trackAppEvent: vi.fn() }));
vi.mock("./auth", () => ({ getCookie: () => state.cookie }));
vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(status: number) {
      super("API error");
      this.status = status;
    }
  },
  api: {
    respondToInteraction: async (id: string, input: Record<string, unknown>) => {
      state.submissions.push({ id, input });
      return state.submit?.(id, input);
    },
    respondToInteractionWithToken: async (id: string, input: Record<string, unknown>) => {
      state.submissions.push({ id, input });
      return state.submit?.(id, input);
    },
    acknowledgePage: async (id: string) => {
      state.pageAcks.push({ id });
      if (state.pageAckError) throw state.pageAckError;
      return { page: {} };
    },
    acknowledgePageWithToken: async (id: string, responseToken: string) => {
      state.pageAcks.push({ id, responseToken });
      if (state.pageAckError) throw state.pageAckError;
      return { ok: true, status: "acknowledged" };
    },
  },
}));

import { router } from "expo-router";
import { Alert, Linking } from "react-native";
import { ApiError } from "./api";
import {
  clearInteractionResponses,
  DEVICE_ID_KEY,
  flushInteractionResponses,
  flushPageAcknowledgements,
  handleNotificationResponse,
  submitInteractionResponse,
} from "./interactions";

const QUEUE_KEY = "hark.interaction.responseQueue.v1";
const DIGEST = "a".repeat(64);

function approvalResponse(interactionId: string) {
  return {
    actionIdentifier: "HARK_APPROVE",
    notification: {
      request: { content: { data: { interactionId, actionDigest: DIGEST } } },
    },
  } as never;
}

function credentialResponse(interactionId: string) {
  return {
    actionIdentifier: "HARK_APPROVE",
    notification: {
      request: {
        content: {
          data: { interactionId, actionDigest: DIGEST, responseToken: "r".repeat(43) },
        },
      },
    },
  } as never;
}

function defaultResponse(url: string) {
  return {
    actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
    notification: {
      request: { content: { data: { url } } },
    },
  } as never;
}

function defaultResponseWithData(data: Record<string, unknown>) {
  return {
    actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
    notification: {
      request: { content: { data } },
    },
  } as never;
}

afterEach(async () => {
  vi.clearAllMocks();
  state.cookie = "session";
  state.submit = undefined;
  state.submissions.length = 0;
  state.pageAcks.length = 0;
  state.pageAckError = undefined;
  await clearInteractionResponses();
  state.store.clear();
});

describe("notification tap destinations", () => {
  it("opens an http(s) destination directly", async () => {
    await handleNotificationResponse(defaultResponse("https://example.com/builds/48"));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(Linking.openURL).toHaveBeenCalledWith("https://example.com/builds/48");
  });

  it.each(["example-app://builds/48", "slack://channel?team=T1&id=C1"])(
    "confirms before opening another app: %s",
    async (url) => {
      vi.mocked(Alert.alert).mockImplementationOnce((_title, _message, buttons) => {
        buttons?.find((button) => button.text === "Cancel")?.onPress?.();
      });
      await handleNotificationResponse(defaultResponse(url));
      expect(Alert.alert).toHaveBeenCalledWith("Open in another app?", url, expect.any(Array));
      expect(Linking.openURL).not.toHaveBeenCalled();

      vi.mocked(Alert.alert).mockImplementationOnce((_title, _message, buttons) => {
        buttons?.find((button) => button.text === "Open")?.onPress?.();
      });
      await handleNotificationResponse(defaultResponse(url));
      expect(Linking.openURL).toHaveBeenCalledWith(url);
    },
  );

  it.each([
    "hark://web/app_12345678?url=/x",
    "ceo.ryan.hark://notification/evt_1",
    "exp+hark://expo-development-client/?url=http://10.0.0.1:8081",
    "exp://10.0.0.1:8081",
    "exps://example.com",
    "example-app://expo-development-client/?url=http://10.0.0.1:8081",
  ])("never re-enters Hark from a tap URL: %s", async (url) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleNotificationResponse(defaultResponse(url));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "not a url"])(
    "ignores an unsafe or malformed destination: %s",
    async (url) => {
      await handleNotificationResponse(defaultResponse(url));
      expect(Linking.openURL).not.toHaveBeenCalled();
    },
  );

  it("keeps the custom URL tap behavior even when an eventId is present", async () => {
    await handleNotificationResponse(
      defaultResponseWithData({
        url: "https://example.com/builds/48",
        eventId: "evt_1",
      }),
    );
    expect(Linking.openURL).toHaveBeenCalledWith("https://example.com/builds/48");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("navigates to the detail route when there is no URL and no interaction", async () => {
    await handleNotificationResponse(defaultResponseWithData({ eventId: "evt_1" }));
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/notification/[id]",
      params: { id: "event:evt_1" },
    });

    await handleNotificationResponse(defaultResponseWithData({ eventId: "anot_2" }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/notification/[id]",
      params: { id: "notification:anot_2" },
    });
  });

  it("never navigates for interaction taps or empty payloads", async () => {
    await handleNotificationResponse(
      defaultResponseWithData({
        interactionId: "int_1",
        actionDigest: DIGEST,
        eventId: "evt_1",
      }),
    );
    await handleNotificationResponse(defaultResponseWithData({}));
    await handleNotificationResponse(defaultResponseWithData({ eventId: "" }));
    expect(router.push).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});

describe("interaction response queue", () => {
  it("uses the durable queue for an in-app response", async () => {
    await submitInteractionResponse("int_inbox", {
      action: "reply",
      response: "Ship it",
      actionDigest: DIGEST,
    });
    expect(state.submissions).toHaveLength(0);
    expect(JSON.parse(state.store.get(QUEUE_KEY) ?? "[]")).toEqual([
      {
        interactionId: "int_inbox",
        input: { action: "reply", response: "Ship it", actionDigest: DIGEST },
      },
    ]);
  });

  it("submits with a response credential without a login cookie", async () => {
    state.cookie = undefined;
    state.store.set(DEVICE_ID_KEY, "dev_1");
    await handleNotificationResponse(credentialResponse("int_credential"));
    expect(state.submissions).toEqual([
      {
        id: "int_credential",
        input: {
          action: "approve",
          actionDigest: DIGEST,
          responseToken: "r".repeat(43),
          deviceId: "dev_1",
        },
      },
    ]);
  });
  it("preserves a response until registration provides a device ID", async () => {
    await handleNotificationResponse(approvalResponse("int_upgrade"));
    expect(state.submissions).toHaveLength(0);
    expect(JSON.parse(state.store.get(QUEUE_KEY) ?? "[]")).toEqual([
      {
        interactionId: "int_upgrade",
        input: { action: "approve", actionDigest: DIGEST },
      },
    ]);

    state.store.set(DEVICE_ID_KEY, "dev_registered");
    await flushInteractionResponses();
    expect(state.submissions).toEqual([
      {
        id: "int_upgrade",
        input: { action: "approve", actionDigest: DIGEST, deviceId: "dev_registered" },
      },
    ]);
    expect(state.store.has(QUEUE_KEY)).toBe(false);
  });

  it("automatically drains a response enqueued during a flush", async () => {
    state.store.set(DEVICE_ID_KEY, "dev_1");
    let releaseFirst: (() => void) | undefined;
    state.submit = (id) =>
      id === "int_first"
        ? new Promise<void>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve();

    const first = handleNotificationResponse(approvalResponse("int_first"));
    await vi.waitFor(() => expect(state.submissions).toHaveLength(1));
    const second = handleNotificationResponse(approvalResponse("int_second"));
    await vi.waitFor(() => expect(JSON.parse(state.store.get(QUEUE_KEY) ?? "[]")).toHaveLength(2));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(state.submissions.map(({ id }) => id)).toEqual(["int_first", "int_second"]);
    expect(state.store.has(QUEUE_KEY)).toBe(false);
  });

  it("coalesces concurrent flushes", async () => {
    state.cookie = undefined;
    await handleNotificationResponse(approvalResponse("int_once"));
    state.cookie = "session";
    state.store.set(DEVICE_ID_KEY, "dev_1");

    await Promise.all([flushInteractionResponses(), flushInteractionResponses()]);
    expect(state.submissions.map(({ id }) => id)).toEqual(["int_once"]);
  });
});

describe("on-call pages", () => {
  const TOKEN = "p".repeat(43);
  const page = {
    v: 1,
    pageId: "page_1",
    teamId: "team_1",
    groupName: "Platform",
    categoryId: "HARK_PAGE_V1",
    responseToken: TOKEN,
    appId: "app_previewstatus",
    url: "https://status.example.com/incidents/1",
  };
  const pageResponse = (actionIdentifier: string, data: Record<string, unknown> = page) =>
    ({ actionIdentifier, notification: { request: { content: { data } } } }) as never;

  it("opens the page screen on tap, even when the page names an app", async () => {
    await handleNotificationResponse(pageResponse("expo.modules.notifications.actions.DEFAULT"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/pages/[id]",
      params: { id: "page_1" },
    });
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("asks before escalating from the notification action", async () => {
    await handleNotificationResponse(pageResponse("HARK_ESCALATE"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/pages/[id]",
      params: { id: "page_1", intent: "escalate" },
    });
    expect(state.pageAcks).toEqual([]);
  });

  it("acknowledges with the response token without a session", async () => {
    state.cookie = undefined;
    await handleNotificationResponse(pageResponse("HARK_ACKNOWLEDGE"));
    expect(state.pageAcks).toEqual([{ id: "page_1", responseToken: TOKEN }]);
    expect(state.store.get("hark.page.ackQueue.v1")).toBeUndefined();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("keeps an acknowledgement queued while offline and drops it once claimed", async () => {
    state.pageAckError = new Error("offline");
    await handleNotificationResponse(pageResponse("HARK_ACKNOWLEDGE"));
    expect(JSON.parse(state.store.get("hark.page.ackQueue.v1") ?? "[]")).toEqual([
      { pageId: "page_1", responseToken: TOKEN },
    ]);

    state.pageAckError = new (ApiError as unknown as new (status: number) => Error)(409);
    await flushPageAcknowledgements();
    expect(state.pageAcks).toHaveLength(2);
    expect(state.store.get("hark.page.ackQueue.v1")).toBeUndefined();
  });

  it("opens team invite links in the join screen", async () => {
    await handleNotificationResponse(defaultResponse("hark://join/abc123"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/join/[code]",
      params: { code: "abc123" },
    });
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});

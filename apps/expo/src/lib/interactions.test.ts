import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookie: "session" as string | undefined,
  store: new Map<string, string>(),
  submissions: [] as Array<{ id: string; input: Record<string, unknown> }>,
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

vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() } }));

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
  },
}));

import {
  clearInteractionResponses,
  DEVICE_ID_KEY,
  flushInteractionResponses,
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

afterEach(async () => {
  state.cookie = "session";
  state.submit = undefined;
  state.submissions.length = 0;
  await clearInteractionResponses();
  state.store.clear();
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

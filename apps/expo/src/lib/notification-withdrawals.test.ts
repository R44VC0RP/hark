import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  presented: [] as Array<{ request: { identifier: string; content: { data: unknown } } }>,
  dismissed: [] as string[],
  failPresentationLookup: false,
  task: undefined as ((input: { data: unknown; error: unknown }) => Promise<number>) | undefined,
}));

vi.mock("expo-notifications", () => ({
  BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 },
  dismissNotificationAsync: async (identifier: string) => {
    state.dismissed.push(identifier);
  },
  getPresentedNotificationsAsync: async () => {
    if (state.failPresentationLookup) throw new Error("lookup failed");
    return state.presented;
  },
  registerTaskAsync: vi.fn(async () => null),
}));

vi.mock("expo-task-manager", () => ({
  defineTask: vi.fn(
    (_name: string, task: (input: { data: unknown; error: unknown }) => Promise<number>) => {
      state.task = task;
    },
  ),
}));

import * as Notifications from "expo-notifications";
import {
  dismissNotificationsForEvent,
  NOTIFICATION_WITHDRAWAL_TASK,
  withdrawalEventId,
} from "./notification-withdrawals";

beforeEach(() => {
  state.presented = [];
  state.dismissed = [];
  state.failPresentationLookup = false;
});

describe("notification withdrawals", () => {
  it("extracts only versioned commands from direct and Expo payloads", () => {
    expect(
      withdrawalEventId({
        v: 1,
        command: "notification.withdraw",
        eventId: "evt_1",
      }),
    ).toBe("evt_1");
    expect(
      withdrawalEventId({
        data: {
          dataString: JSON.stringify({
            v: 1,
            command: "notification.withdraw",
            eventId: "evt_2",
          }),
        },
      }),
    ).toBe("evt_2");
    expect(
      withdrawalEventId({
        body: JSON.stringify({
          v: 1,
          command: "notification.withdraw",
          eventId: "evt_3",
        }),
      }),
    ).toBe("evt_3");
    expect(
      withdrawalEventId({
        command: "notification.withdraw",
        eventId: "evt_unversioned",
      }),
    ).toBeNull();
    expect(
      withdrawalEventId({
        v: 1,
        command: "notification.keep",
        eventId: "evt_wrong_command",
      }),
    ).toBeNull();
  });

  it("dismisses every presented notification with the matching event ID", async () => {
    state.presented = [
      {
        request: {
          identifier: "notification-1",
          content: { data: { eventId: "evt_1", sourceName: "CI" } },
        },
      },
      {
        request: {
          identifier: "notification-2",
          content: { data: { body: JSON.stringify({ eventId: "evt_1" }) } },
        },
      },
      {
        request: {
          identifier: "notification-3",
          content: { data: { eventId: "evt_2", sourceName: "CI" } },
        },
      },
    ];

    await expect(dismissNotificationsForEvent("evt_1")).resolves.toBe(2);
    expect(state.dismissed).toEqual(["notification-1", "notification-2"]);
  });

  it("registers a background task and reports its fetch result", async () => {
    expect(Notifications.registerTaskAsync).toHaveBeenCalledWith(NOTIFICATION_WITHDRAWAL_TASK);
    const task = state.task;
    if (!task) throw new Error("Withdrawal task was not defined");

    state.presented = [
      {
        request: {
          identifier: "notification-1",
          content: { data: { eventId: "evt_1" } },
        },
      },
    ];
    const command = {
      data: {
        dataString: JSON.stringify({
          v: 1,
          command: "notification.withdraw",
          eventId: "evt_1",
        }),
      },
    };
    await expect(task({ data: command, error: null })).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.NewData,
    );
    await expect(task({ data: { command: "other" }, error: null })).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.NoData,
    );

    state.failPresentationLookup = true;
    await expect(task({ data: command, error: null })).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.Failed,
    );
    await expect(task({ data: command, error: new Error("task failed") })).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.Failed,
    );
  });
});

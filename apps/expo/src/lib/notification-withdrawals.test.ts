import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  presented: [] as Array<{ request: { identifier: string; content: { data: unknown } } }>,
  dismissed: [] as string[],
}));

vi.mock("expo-notifications", () => ({
  BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 },
  dismissNotificationAsync: async (identifier: string) => {
    state.dismissed.push(identifier);
  },
  getPresentedNotificationsAsync: async () => state.presented,
  registerTaskAsync: vi.fn(async () => null),
}));

vi.mock("expo-task-manager", () => ({ defineTask: vi.fn() }));

import { dismissNotificationsForEvent, withdrawalEventId } from "./notification-withdrawals";

beforeEach(() => {
  state.presented = [];
  state.dismissed = [];
});

describe("notification withdrawals", () => {
  it("extracts direct and Expo dataString commands", () => {
    expect(withdrawalEventId({ command: "notification.withdraw", eventId: "evt_1" })).toBe("evt_1");
    expect(
      withdrawalEventId({
        data: {
          dataString: JSON.stringify({ command: "notification.withdraw", eventId: "evt_2" }),
        },
      }),
    ).toBe("evt_2");
    expect(
      withdrawalEventId({
        body: JSON.stringify({ command: "notification.withdraw", eventId: "evt_3" }),
      }),
    ).toBe("evt_3");
    expect(withdrawalEventId({ command: "notification.keep", eventId: "evt_4" })).toBeNull();
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
          content: { data: { eventId: "evt_2", sourceName: "CI" } },
        },
      },
    ];

    await expect(dismissNotificationsForEvent("evt_1")).resolves.toBe(1);
    expect(state.dismissed).toEqual(["notification-1"]);
  });
});

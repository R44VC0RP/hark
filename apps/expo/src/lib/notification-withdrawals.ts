import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

const NOTIFICATION_WITHDRAWAL_TASK = "hark-notification-withdrawal-v1";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function parseObject(value: unknown): JsonObject | null {
  if (typeof value !== "string") return asObject(value);
  try {
    return asObject(JSON.parse(value));
  } catch {
    return null;
  }
}

/** Accept Expo's task envelope, notification content data, or the command itself. */
export function withdrawalEventId(payload: unknown): string | null {
  const root = asObject(payload);
  if (!root) return null;
  const data = parseObject(root.data);
  const dataString = data ? parseObject(data.dataString) : null;
  const body = parseObject(root.body);
  const candidates = [root, data, dataString, body];

  for (const candidate of candidates) {
    if (
      candidate?.command === "notification.withdraw" &&
      typeof candidate.eventId === "string" &&
      candidate.eventId.length > 0
    ) {
      return candidate.eventId;
    }
  }
  return null;
}

function presentedEventId(payload: unknown): string | null {
  const root = asObject(payload);
  if (!root) return null;
  const body = parseObject(root.body);
  for (const candidate of [root, body]) {
    if (typeof candidate?.eventId === "string" && candidate.eventId.length > 0) {
      return candidate.eventId;
    }
  }
  return null;
}

export async function dismissNotificationsForEvent(eventId: string): Promise<number> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const matching = presented.filter(
    (notification) => presentedEventId(notification.request.content.data) === eventId,
  );
  await Promise.all(
    matching.map((notification) =>
      Notifications.dismissNotificationAsync(notification.request.identifier),
    ),
  );
  return matching.length;
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  NOTIFICATION_WITHDRAWAL_TASK,
  async ({ data, error }) => {
    if (error) return Notifications.BackgroundNotificationTaskResult.Failed;
    const eventId = withdrawalEventId(data);
    if (!eventId) return Notifications.BackgroundNotificationTaskResult.NoData;
    try {
      const dismissed = await dismissNotificationsForEvent(eventId);
      return dismissed > 0
        ? Notifications.BackgroundNotificationTaskResult.NewData
        : Notifications.BackgroundNotificationTaskResult.NoData;
    } catch {
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }
  },
);

void Notifications.registerTaskAsync(NOTIFICATION_WITHDRAWAL_TASK).catch((error) => {
  console.warn("Could not register notification withdrawal task", error);
});

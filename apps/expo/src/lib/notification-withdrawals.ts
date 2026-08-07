import { notificationWithdrawalPushDataSchema } from "@hark/contracts";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

export const NOTIFICATION_WITHDRAWAL_TASK = "hark-notification-withdrawal-v1";

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

function payloadCandidates(payload: unknown): JsonObject[] {
  const root = asObject(payload);
  if (!root) return [];
  const data = parseObject(root.data);
  return [root, data, data ? parseObject(data.dataString) : null, parseObject(root.body)].filter(
    (candidate): candidate is JsonObject => candidate !== null,
  );
}

/** Accept Expo task envelopes, notification content data, and direct commands. */
export function withdrawalEventId(payload: unknown): string | null {
  for (const candidate of payloadCandidates(payload)) {
    const parsed = notificationWithdrawalPushDataSchema.safeParse(candidate);
    if (parsed.success) return parsed.data.eventId;
  }
  return null;
}

function presentedEventId(payload: unknown): string | null {
  for (const candidate of payloadCandidates(payload)) {
    if (typeof candidate.eventId === "string" && candidate.eventId.length > 0) {
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

export async function handleNotificationWithdrawalTask({
  data,
  error,
}: {
  data: unknown;
  error: unknown;
}): Promise<Notifications.BackgroundNotificationTaskResult> {
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
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  NOTIFICATION_WITHDRAWAL_TASK,
  handleNotificationWithdrawalTask,
);

void Notifications.registerTaskAsync(NOTIFICATION_WITHDRAWAL_TASK).catch((error) => {
  console.warn("Could not register notification withdrawal task", error);
});

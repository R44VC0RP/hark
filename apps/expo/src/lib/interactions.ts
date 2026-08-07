import {
  HARK_APPROVAL_CATEGORY_ID,
  HARK_APPROVE_ACTION_ID,
  HARK_DENY_ACTION_ID,
  HARK_NO_ACTION_ID,
  HARK_REPLY_ACTION_ID,
  HARK_REPLY_CATEGORY_ID,
  HARK_YES_ACTION_ID,
  HARK_YES_NO_CATEGORY_ID,
  tapDestinationUrlSchema,
  type InteractionResponseInput,
} from "@hark/contracts";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Linking } from "react-native";
import { trackAppEvent } from "./analytics";
import { ApiError, api } from "./api";
import { getCookie } from "./auth";

export const DEVICE_ID_KEY = "hark.device.serverId";
const RETRY_QUEUE_KEY = "hark.interaction.responseQueue.v1";
const MAX_QUEUED_RESPONSES = 20;

export type InteractionActionInput =
  | { action: "approve" | "deny" | "yes" | "no"; actionDigest: string }
  | { action: "reply"; response: string; actionDigest: string };

interface QueuedResponse {
  interactionId: string;
  input: InteractionActionInput;
  responseToken?: string;
}

let queueMutation = Promise.resolve();
let flushing: Promise<void> | null = null;
let flushRequested = false;

function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueMutation.then(operation, operation);
  queueMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readQueue(): Promise<QueuedResponse[]> {
  try {
    const value = await SecureStore.getItemAsync(RETRY_QUEUE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QueuedResponse =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as QueuedResponse).interactionId === "string" &&
        typeof (item as QueuedResponse).input === "object" &&
        (item as QueuedResponse).input !== null &&
        typeof (item as QueuedResponse).input.actionDigest === "string",
    );
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedResponse[]): Promise<void> {
  if (queue.length === 0) {
    await SecureStore.deleteItemAsync(RETRY_QUEUE_KEY);
    return;
  }
  await SecureStore.setItemAsync(
    RETRY_QUEUE_KEY,
    JSON.stringify(queue.slice(-MAX_QUEUED_RESPONSES)),
  );
}

async function enqueue(response: QueuedResponse): Promise<void> {
  flushRequested = true;
  await withQueueLock(async () => {
    const queue = await readQueue();
    if (queue.some((item) => item.interactionId === response.interactionId)) return;
    queue.push(response);
    await writeQueue(queue);
  });
}

function isTerminalApiError(error: unknown): boolean {
  return error instanceof ApiError && [400, 404, 409].includes(error.status);
}

async function submitOrQueue(response: QueuedResponse): Promise<void> {
  await enqueue(response);
  await flushInteractionResponses();
}

export async function submitInteractionResponse(
  interactionId: string,
  input: InteractionActionInput,
): Promise<void> {
  await submitOrQueue({ interactionId, input });
}

export async function flushInteractionResponses(): Promise<void> {
  if (flushing) {
    flushRequested = true;
    return flushing;
  }
  const task = (async () => {
    while (true) {
      flushRequested = false;
      const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
      if (!deviceId) return;
      const queue = await withQueueLock(readQueue);
      if (queue.length === 0) {
        if (flushRequested) continue;
        return;
      }
      const completed = new Set<string>();
      for (const response of queue) {
        try {
          if (response.responseToken) {
            await api.respondToInteractionWithToken(response.interactionId, {
              ...response.input,
              responseToken: response.responseToken,
              deviceId,
            });
          } else {
            if (!getCookie()) continue;
            const input: InteractionResponseInput = { ...response.input, deviceId };
            await api.respondToInteraction(response.interactionId, input);
          }
          completed.add(response.interactionId);
        } catch (error) {
          if (isTerminalApiError(error)) completed.add(response.interactionId);
        }
      }
      if (completed.size === 0) return;
      await withQueueLock(async () => {
        const current = await readQueue();
        await writeQueue(current.filter((response) => !completed.has(response.interactionId)));
      });
      // Continue immediately so work enqueued during this pass cannot be stranded.
    }
  })();
  flushing = task;
  try {
    await task;
  } finally {
    if (flushing === task) flushing = null;
  }
}

export async function clearInteractionResponses(): Promise<void> {
  await withQueueLock(async () => {
    await SecureStore.deleteItemAsync(RETRY_QUEUE_KEY);
  });
}

export async function registerInteractionCategories(): Promise<void> {
  const opensAuthenticatedApp = {
    isAuthenticationRequired: true,
    opensAppToForeground: true,
  };
  await Promise.all([
    Notifications.setNotificationCategoryAsync(HARK_APPROVAL_CATEGORY_ID, [
      {
        identifier: HARK_APPROVE_ACTION_ID,
        buttonTitle: "Approve",
        options: opensAuthenticatedApp,
      },
      {
        identifier: HARK_DENY_ACTION_ID,
        buttonTitle: "Deny",
        options: { ...opensAuthenticatedApp, isDestructive: true },
      },
    ]),
    Notifications.setNotificationCategoryAsync(HARK_REPLY_CATEGORY_ID, [
      {
        identifier: HARK_REPLY_ACTION_ID,
        buttonTitle: "Reply",
        textInput: { submitButtonTitle: "Send", placeholder: "Reply" },
        options: opensAuthenticatedApp,
      },
    ]),
    Notifications.setNotificationCategoryAsync(HARK_YES_NO_CATEGORY_ID, [
      {
        identifier: HARK_YES_ACTION_ID,
        buttonTitle: "Yes",
        options: opensAuthenticatedApp,
      },
      {
        identifier: HARK_NO_ACTION_ID,
        buttonTitle: "No",
        options: { ...opensAuthenticatedApp, isDestructive: true },
      },
    ]),
  ]);
}

export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
): Promise<void> {
  const data = response.notification.request.content.data as
    | { interactionId?: string; actionDigest?: string; responseToken?: string; url?: string }
    | undefined;
  if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    const destination = tapDestinationUrlSchema.safeParse(data?.url);
    let destinationHost: string | undefined;
    if (destination.success) {
      try {
        const parsed = new URL(destination.data);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          destinationHost = parsed.hostname.slice(0, 64);
        }
      } catch {
        // The shared schema already rejects malformed URLs.
      }
    }
    void trackAppEvent("notification_opened", {
      path: "/inbox",
      properties: { destinationHost },
    });
    if (destination.success) await Linking.openURL(destination.data).catch(() => {});
    return;
  }
  if (!data?.interactionId || !data.actionDigest) return;

  let input: InteractionActionInput | undefined;
  if (response.actionIdentifier === HARK_APPROVE_ACTION_ID) {
    input = { action: "approve", actionDigest: data.actionDigest };
  } else if (response.actionIdentifier === HARK_DENY_ACTION_ID) {
    input = { action: "deny", actionDigest: data.actionDigest };
  } else if (response.actionIdentifier === HARK_REPLY_ACTION_ID && response.userText?.trim()) {
    input = {
      action: "reply",
      response: response.userText.trim(),
      actionDigest: data.actionDigest,
    };
  } else if (response.actionIdentifier === HARK_YES_ACTION_ID) {
    input = { action: "yes", actionDigest: data.actionDigest };
  } else if (response.actionIdentifier === HARK_NO_ACTION_ID) {
    input = { action: "no", actionDigest: data.actionDigest };
  }
  if (input) {
    await submitOrQueue({
      interactionId: data.interactionId,
      input,
      ...(data.responseToken ? { responseToken: data.responseToken } : {}),
    });
  }
}

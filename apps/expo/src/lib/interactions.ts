import {
  HARK_ACKNOWLEDGE_ACTION_ID,
  HARK_APPROVAL_CATEGORY_ID,
  HARK_APPROVE_ACTION_ID,
  HARK_DENY_ACTION_ID,
  HARK_ESCALATE_ACTION_ID,
  HARK_NO_ACTION_ID,
  HARK_PAGE_CATEGORY_ID,
  HARK_REPLY_ACTION_ID,
  HARK_REPLY_CATEGORY_ID,
  HARK_YES_ACTION_ID,
  HARK_YES_NO_CATEGORY_ID,
  type InteractionResponseInput,
  tapDestinationUrlSchema,
} from "@hark/contracts";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { trackAppEvent } from "./analytics";
import { ApiError, api } from "./api";
import { getCookie } from "./auth";
import { compositeIdForPushEvent, openTopLevelDestination } from "./inbox-body";
import { claimedPageId, joinCodeFromUrl, pagePushData } from "./teams";

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
/**
 * Answers given in the app whose own first attempt is still out: already
 * in the queue (so they survive the app being closed or killed), but no
 * flush sends them until that attempt settles or is given up on.
 */
const answering = new Set<string>();
/**
 * Responses taken out of the queue since the current flush pass read it:
 * the pass skips them, so it never sends one that already settled.
 */
let removedSinceRead = new Set<string>();

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

/**
 * An answer given in the app, saved in the queue before it is sent (as
 * before the redesign), so it survives the app being closed or killed while
 * the request is out (R4-02). It replaces any answer queued earlier for the
 * same request: the newest one is what the person sees. Flushes leave it
 * alone until `leaveAnswerToQueue` or `removeQueuedAnswer`.
 */
export async function saveAnswerBeforeSending(
  interactionId: string,
  input: InteractionActionInput,
): Promise<void> {
  answering.add(interactionId);
  try {
    await withQueueLock(async () => {
      const queue = await readQueue();
      const rest = queue.filter((item) => item.interactionId !== interactionId);
      await writeQueue([...rest, { interactionId, input }]);
    });
  } catch (error) {
    answering.delete(interactionId);
    throw error;
  }
}

/**
 * The app's own attempt got no response (no connection, or none in time):
 * the saved answer is the queue's to send now (on launch, on return to the
 * app, every 30 s), starting at once.
 */
export function leaveAnswerToQueue(interactionId: string): void {
  answering.delete(interactionId);
  flushRequested = true;
  void flushInteractionResponses();
}

/**
 * The server settled the answer (took it, or refused it and the person was
 * told): it leaves the queue, and a flush pass that read it before is told
 * to skip it. The queue's stored shape is unchanged.
 */
export async function removeQueuedAnswer(interactionId: string): Promise<void> {
  try {
    await withQueueLock(async () => {
      const queue = await readQueue();
      const rest = queue.filter((item) => item.interactionId !== interactionId);
      if (rest.length !== queue.length) await writeQueue(rest);
      removedSinceRead.add(interactionId);
    });
  } finally {
    answering.delete(interactionId);
  }
}

/**
 * Calls `visit` with the answers waiting in the queue (not the ones the app
 * is still sending itself), inside the queue's lock: anything `visit`
 * marks happens before the queue can deliver one and report it.
 */
export async function visitQueuedAnswers(
  visit: (answers: readonly { interactionId: string; input: InteractionActionInput }[]) => void,
): Promise<void> {
  await withQueueLock(async () => {
    const queue = await readQueue();
    visit(queue.filter((item) => !answering.has(item.interactionId)));
  });
}

/**
 * In memory only: the queue's verdict on each response it finishes, the
 * server took it (`delivered`) or refused it for good (400/404/409), so the
 * Inbox can show what happened to an answer it queued.
 */
type QueuedResponseListener = (interactionId: string, delivered: boolean) => void;
const queuedResponseListeners = new Set<QueuedResponseListener>();

export function onQueuedResponseDone(listener: QueuedResponseListener): () => void {
  queuedResponseListeners.add(listener);
  return () => {
    queuedResponseListeners.delete(listener);
  };
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
      const queue = await withQueueLock(() => {
        removedSinceRead = new Set();
        return readQueue();
      });
      if (queue.length === 0) {
        if (flushRequested) continue;
        return;
      }
      const completed = new Set<string>();
      const delivered = new Set<string>();
      for (const response of queue) {
        // The app's own attempt is still out, or the answer already settled.
        if (answering.has(response.interactionId)) continue;
        if (removedSinceRead.has(response.interactionId)) continue;
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
          delivered.add(response.interactionId);
        } catch (error) {
          if (isTerminalApiError(error)) completed.add(response.interactionId);
        }
      }
      if (completed.size === 0) return;
      await withQueueLock(async () => {
        const current = await readQueue();
        await writeQueue(current.filter((response) => !completed.has(response.interactionId)));
      });
      for (const interactionId of completed) {
        for (const listener of queuedResponseListeners) {
          listener(interactionId, delivered.has(interactionId));
        }
      }
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
    await SecureStore.deleteItemAsync(PAGE_ACK_QUEUE_KEY);
  });
}

// On-call page acknowledgements from the lock screen use their own queue so
// the interaction queue's shape (and its stored data) stays unchanged.
const PAGE_ACK_QUEUE_KEY = "hark.page.ackQueue.v1";

interface QueuedPageAck {
  pageId: string;
  responseToken?: string;
}

async function readPageAckQueue(): Promise<QueuedPageAck[]> {
  try {
    const value = await SecureStore.getItemAsync(PAGE_ACK_QUEUE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QueuedPageAck =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as QueuedPageAck).pageId === "string",
    );
  } catch {
    return [];
  }
}

async function writePageAckQueue(queue: QueuedPageAck[]): Promise<void> {
  if (queue.length === 0) {
    await SecureStore.deleteItemAsync(PAGE_ACK_QUEUE_KEY);
    return;
  }
  await SecureStore.setItemAsync(
    PAGE_ACK_QUEUE_KEY,
    JSON.stringify(queue.slice(-MAX_QUEUED_RESPONSES)),
  );
}

/** Sends queued page acknowledgements; 400/404/409 (e.g. already claimed) are final. */
async function flushPageAcks(): Promise<void> {
  const queue = await withQueueLock(readPageAckQueue);
  if (queue.length === 0) return;
  const completed = new Set<string>();
  for (const ack of queue) {
    try {
      if (ack.responseToken) {
        await api.acknowledgePageWithToken(ack.pageId, ack.responseToken);
      } else {
        if (!getCookie()) continue;
        await api.acknowledgePage(ack.pageId);
      }
      completed.add(ack.pageId);
    } catch (error) {
      if (isTerminalApiError(error)) completed.add(ack.pageId);
    }
  }
  if (completed.size === 0) return;
  await withQueueLock(async () => {
    const current = await readPageAckQueue();
    await writePageAckQueue(current.filter((ack) => !completed.has(ack.pageId)));
  });
}

let pageFlush: Promise<void> | null = null;

export async function flushPageAcknowledgements(): Promise<void> {
  if (pageFlush) return pageFlush;
  const task = flushPageAcks();
  pageFlush = task;
  try {
    await task;
  } finally {
    if (pageFlush === task) pageFlush = null;
  }
}

export async function submitPageAcknowledgement(ack: QueuedPageAck): Promise<void> {
  await withQueueLock(async () => {
    const queue = await readPageAckQueue();
    if (queue.some((item) => item.pageId === ack.pageId)) return;
    queue.push(ack);
    await writePageAckQueue(queue);
  });
  await flushPageAcknowledgements();
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
    Notifications.setNotificationCategoryAsync(HARK_PAGE_CATEGORY_ID, [
      {
        identifier: HARK_ACKNOWLEDGE_ACTION_ID,
        buttonTitle: "Acknowledge",
        options: opensAuthenticatedApp,
      },
      {
        identifier: HARK_ESCALATE_ACTION_ID,
        buttonTitle: "Escalate",
        options: opensAuthenticatedApp,
      },
    ]),
  ]);
}

/** Where a notification tap goes: a route in the router's object form. */
export interface NotificationDestination {
  pathname: "/pages/[id]" | "/join/[code]" | "/notification/[id]" | "/web/[id]";
  params: Record<string, string>;
}

/**
 * How a notification tap navigates: every destination (page, invite,
 * notification detail, web app) goes through `open`. The root layout
 * installs `src/lib/navigation.ts`'s `goTo`, the one way into the app from
 * outside the current screen, so a tap never opens inside or under a sheet
 * and never pushes a second copy of the tabs over a web app (R4-01). Until
 * then (and in tests) it pushes the route.
 */
export interface NotificationNavigation {
  open(destination: NotificationDestination): void;
}

let notificationNavigation: NotificationNavigation = {
  open: (destination) => router.push(destination),
};

export function setNotificationNavigation(navigation: NotificationNavigation): void {
  notificationNavigation = navigation;
}

/** Best-effort push navigation that tolerates a not-yet-mounted router on cold start. */
function navigateSoon(navigate: () => void): void {
  try {
    navigate();
  } catch {
    setTimeout(() => {
      try {
        navigate();
      } catch {
        // The destination stays reachable from the home screen.
      }
    }, 500);
  }
}

function openPage(pageId: string, intent?: "escalate"): void {
  navigateSoon(() =>
    notificationNavigation.open({
      pathname: "/pages/[id]",
      params: { id: pageId, ...(intent ? { intent } : {}) },
    }),
  );
}

function openJoin(code: string): void {
  navigateSoon(() => notificationNavigation.open({ pathname: "/join/[code]", params: { code } }));
}

/** Handles taps and actions on on-call pages; returns false for other pushes. */
async function handlePageResponse(response: Notifications.NotificationResponse): Promise<boolean> {
  // The quiet "Claimed by <name>" notice that replaces a page's alert.
  const claimed = claimedPageId(response.notification.request.content.data);
  if (claimed) {
    openPage(claimed);
    void trackAppEvent("notification_opened", { path: "/pages", properties: {} });
    return true;
  }
  const page = pagePushData(response.notification.request.content.data);
  if (!page) return false;
  if (response.actionIdentifier === HARK_ACKNOWLEDGE_ACTION_ID) {
    void trackAppEvent("notification_opened", { path: "/pages", properties: {} });
    await submitPageAcknowledgement(page);
    return true;
  }
  // Escalating changes who gets woken up, so it is confirmed on the page screen.
  openPage(
    page.pageId,
    response.actionIdentifier === HARK_ESCALATE_ACTION_ID ? "escalate" : undefined,
  );
  void trackAppEvent("notification_opened", { path: "/pages", properties: {} });
  return true;
}

function openNotificationDetail(compositeId: string): void {
  navigateSoon(() =>
    notificationNavigation.open({ pathname: "/notification/[id]", params: { id: compositeId } }),
  );
}

function openWebApp(appId: string, url: string | undefined): void {
  navigateSoon(() =>
    notificationNavigation.open({
      pathname: "/web/[id]",
      params: { id: appId, ...(url ? { url } : {}) },
    }),
  );
}

export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
): Promise<void> {
  const data = response.notification.request.content.data as
    | {
        interactionId?: string;
        actionDigest?: string;
        responseToken?: string;
        url?: string;
        eventId?: string;
        appId?: string;
      }
    | undefined;
  if (await handlePageResponse(response)) return;
  if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    // Team invites open the in-app join screen instead of the browser.
    const joinCode = joinCodeFromUrl(data?.url);
    if (joinCode) {
      void trackAppEvent("notification_opened", { path: "/join", properties: {} });
      openJoin(joinCode);
      return;
    }
    // App notifications open inside Hark, signed in; the web view only honors
    // `url` when it belongs to the app origin.
    if (typeof data?.appId === "string" && /^app_[A-Za-z0-9_-]{8,64}$/.test(data.appId)) {
      void trackAppEvent("notification_opened", { path: "/web", properties: {} });
      openWebApp(data.appId, typeof data.url === "string" ? data.url : undefined);
      return;
    }
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
    // A custom tap URL always wins; it opens with the shared link policy
    // (http(s) directly, other apps after confirmation, Hark's own schemes never).
    if (destination.success) {
      await openTopLevelDestination(destination.data);
      return;
    }
    // No URL and no interaction: open the notification detail when possible.
    if (!data?.interactionId && typeof data?.eventId === "string" && data.eventId.length > 0) {
      openNotificationDetail(compositeIdForPushEvent(data.eventId));
    }
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

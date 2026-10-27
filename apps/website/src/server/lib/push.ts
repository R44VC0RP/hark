import {
  HARK_APPROVAL_CATEGORY_ID,
  HARK_PAGE_CATEGORY_ID,
  HARK_PAGE_SOUND,
  HARK_REPLY_CATEGORY_ID,
  HARK_YES_NO_CATEGORY_ID,
  type InteractionKind,
  type InteractionPushData,
  type NotificationWithdrawalPushData,
  type OncallPagePushData,
  PUSH_SCHEMA_VERSION,
  type PushData,
  type WebhookRequest,
} from "@hark/contracts";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { env } from "../env";
import { fitPushMessage } from "./push-preview";

export interface ServiceDefaults {
  title: string;
  imageUrl: string | null;
  url: string | null;
}

export interface ResolvedNotification {
  title: string;
  body: string;
  imageUrl?: string;
  url?: string;
  /** Sender-supplied digest; when present it replaces the body in push text. */
  summary?: string;
}

/** Webhook overrides win; otherwise fall back to the service defaults. */
export function resolveNotification(
  service: ServiceDefaults,
  request: WebhookRequest,
): ResolvedNotification {
  return {
    title: request.title ?? service.title,
    body: request.body,
    imageUrl: request.imageUrl ?? service.imageUrl ?? undefined,
    url: request.url ?? service.url ?? undefined,
    ...(request.summary !== undefined ? { summary: request.summary } : {}),
  };
}

export interface BuildPushInput {
  to: string[];
  eventId: string;
  serviceId: string;
  /** Overrides the thread grouping; defaults to the service so each service is one conversation. */
  conversationKey?: string;
  /** Optional project association carried as backward-compatible push metadata. */
  projectId?: string;
  /** Web app opened on tap; never dropped when the payload is byte-fit. */
  appId?: string;
  resolved: ResolvedNotification;
}

const WELCOME_AVATAR_URL =
  "https://pbs.twimg.com/profile_images/2070959207273082880/HZoVBuA2_400x400.jpg";
const WELCOME_MESSAGES = [
  {
    body: "hey! my name is ryan and I made hark!",
    url: "https://x.com/ryanvogel",
  },
  {
    body: "easily send notifications via a webhook",
    url: "https://hark.ryan.ceo",
  },
  {
    body: "get started here (click me)",
    url: "https://hark.ryan.ceo",
  },
] as const;

export function buildWelcomePushMessages(to: string): ExpoPushMessage[] {
  return WELCOME_MESSAGES.map((message, index) => {
    const data: PushData = {
      v: PUSH_SCHEMA_VERSION,
      eventId: `hark-welcome-${index + 1}`,
      serviceId: "hark-welcome",
      sourceId: "ryan",
      sourceName: "Ryan",
      avatarUrl: WELCOME_AVATAR_URL,
      url: message.url,
      conversationId: "hark-welcome-ryan",
    };
    return {
      to,
      title: "Ryan",
      body: message.body,
      priority: "high",
      mutableContent: true,
      richContent: { image: WELCOME_AVATAR_URL },
      data,
    };
  });
}

export function buildPushMessages(input: BuildPushInput): ExpoPushMessage[] {
  const { to, eventId, serviceId, conversationKey, projectId, appId, resolved } = input;
  const data: PushData = {
    v: PUSH_SCHEMA_VERSION,
    eventId,
    serviceId,
    sourceId: serviceId,
    sourceName: resolved.title,
    ...(resolved.imageUrl ? { avatarUrl: resolved.imageUrl } : {}),
    ...(resolved.url ? { url: resolved.url } : {}),
    conversationId: `hark-${conversationKey ?? serviceId}`,
    ...(projectId ? { projectId } : {}),
    ...(appId ? { appId } : {}),
  };

  // The full body never enters the push payload: the summary wins when the
  // sender provided one, and the whole message is byte-fit below the APNs
  // size cap (body first, then optional display metadata).
  return to.map((token) =>
    fitPushMessage({
      to: token,
      title: resolved.title,
      body: resolved.summary ?? resolved.body,
      priority: "high",
      mutableContent: true,
      ...(resolved.imageUrl ? { richContent: { image: resolved.imageUrl } } : {}),
      data,
    }),
  );
}

export function buildNotificationWithdrawalPushMessages(
  to: string[],
  eventId: string,
): ExpoPushMessage[] {
  const data: NotificationWithdrawalPushData = {
    v: PUSH_SCHEMA_VERSION,
    command: "notification.withdraw",
    eventId,
  };
  return to.map((token) => ({
    to: token,
    data,
    _contentAvailable: true,
  }));
}

export interface BuildInteractionPushInput {
  to: string[];
  interactionId: string;
  kind: InteractionKind;
  title: string;
  prompt: string;
  actionDigest: string;
  responseToken?: string;
  eventId?: string;
  imageUrl?: string;
  url?: string;
}

export function buildInteractionPushMessages(input: BuildInteractionPushInput): ExpoPushMessage[] {
  const categoryId =
    input.kind === "approval"
      ? HARK_APPROVAL_CATEGORY_ID
      : input.kind === "yes_no"
        ? HARK_YES_NO_CATEGORY_ID
        : HARK_REPLY_CATEGORY_ID;
  const data: InteractionPushData = {
    v: PUSH_SCHEMA_VERSION,
    interactionId: input.interactionId,
    ...(input.eventId ? { eventId: input.eventId } : {}),
    interactionKind: input.kind,
    sourceName: input.title,
    conversationId: `hark-interaction-${input.interactionId}`,
    categoryId,
    actionDigest: input.actionDigest,
    ...(input.responseToken ? { responseToken: input.responseToken } : {}),
    ...(input.imageUrl ? { avatarUrl: input.imageUrl } : {}),
    ...(input.url ? { url: input.url } : {}),
  };
  return input.to.map((to) =>
    fitPushMessage({
      to,
      title: input.title,
      body: input.prompt,
      categoryId,
      priority: "high",
      mutableContent: true,
      ...(input.imageUrl ? { richContent: { image: input.imageUrl } } : {}),
      data,
    }),
  );
}

export interface PageTarget {
  token: string;
  /** The device reported that its user allowed Critical Alerts. */
  critical: boolean;
}

export interface BuildPagePushInput {
  to: PageTarget[];
  pageId: string;
  teamId: string;
  groupName: string;
  title: string;
  body: string;
  responseToken?: string;
  url?: string;
  appId?: string;
  /** Repeat alert number; 0 for the first alert. */
  ring?: number;
}

/**
 * APNs collapse ID shared by every alert for one page, so a repeat replaces
 * the alert on screen instead of stacking. A replaced alert still plays its
 * sound. Kept well under the 64-byte APNs limit.
 */
export function pageCollapseId(pageId: string): string {
  return `hark-page-${pageId}`.slice(0, 64);
}

/**
 * An on-call page, with Acknowledge / Escalate actions and the bundled alarm
 * sound. Devices whose user allowed Critical Alerts get a critical alert at
 * full volume, which plays through the silent switch and Focus; everyone else
 * gets a time-sensitive alert, which breaks through Focus but not silent mode.
 */
export function buildPagePushMessages(input: BuildPagePushInput): ExpoPushMessage[] {
  const data: OncallPagePushData = {
    v: PUSH_SCHEMA_VERSION,
    pageId: input.pageId,
    teamId: input.teamId,
    groupName: input.groupName,
    categoryId: HARK_PAGE_CATEGORY_ID,
    ...(input.responseToken ? { responseToken: input.responseToken } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.appId ? { appId: input.appId } : {}),
    ...(input.ring ? { ring: input.ring } : {}),
  };
  return input.to.map((target) =>
    fitPushMessage({
      to: target.token,
      title: input.title,
      body: input.body,
      categoryId: HARK_PAGE_CATEGORY_ID,
      priority: "high",
      ...(target.critical
        ? {
            sound: { critical: true, name: HARK_PAGE_SOUND, volume: 1 },
            interruptionLevel: "critical" as const,
          }
        : { sound: HARK_PAGE_SOUND, interruptionLevel: "time-sensitive" as const }),
      collapseId: pageCollapseId(input.pageId),
      mutableContent: true,
      data,
    }),
  );
}

/**
 * Clears a page from devices once someone claims it. With `notice`, the push
 * also replaces the ringing alert (same collapse ID) with a quiet, passive
 * "Claimed by <name>" notification instead of just withdrawing it.
 */
export function buildPageClaimedPushMessages(
  to: string[],
  pageId: string,
  claimedBy: string,
  notice?: { title: string; body: string },
): ExpoPushMessage[] {
  const data: PushData = { v: PUSH_SCHEMA_VERSION, command: "page.claimed", pageId, claimedBy };
  return to.map((token) => ({
    to: token,
    data,
    _contentAvailable: true,
    ...(notice
      ? {
          title: notice.title,
          body: notice.body,
          sound: null,
          interruptionLevel: "passive" as const,
          collapseId: pageCollapseId(pageId),
        }
      : {}),
  }));
}

let expoClient: Expo | undefined;
function getExpo(): Expo {
  if (!expoClient) {
    expoClient = new Expo(env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : {});
  }
  return expoClient;
}

export interface SendResult {
  /** Requests accepted by Expo. This is not a device-delivery receipt. */
  accepted: number;
  errors: string[];
  /** Expo push tokens that Expo reported as no longer registered. */
  staleTokens: string[];
}

export async function sendPushMessages(messages: ExpoPushMessage[]): Promise<SendResult> {
  const expo = getExpo();
  const result: SendResult = { accepted: 0, errors: [], staleTokens: [] };

  for (const chunk of expo.chunkPushNotifications(messages)) {
    let tickets: ExpoPushTicket[];
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Expo push request failed");
      continue;
    }
    tickets.forEach((ticket, index) => {
      if (ticket.status === "ok") {
        result.accepted += 1;
        return;
      }
      result.errors.push(ticket.message ?? "Unknown push error");
      const to = chunk[index]?.to;
      if (ticket.details?.error === "DeviceNotRegistered" && typeof to === "string") {
        result.staleTokens.push(to);
      }
    });
  }

  return result;
}

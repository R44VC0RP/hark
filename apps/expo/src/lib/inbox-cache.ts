import type { InboxInteractionDto } from "@hark/contracts";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { ApiError, api } from "./api";
import { DEVICE_ID_KEY, onQueuedResponseDone, queueInteractionResponse } from "./interactions";

/**
 * Hands a request from the Inbox to the Reply sheet (DESIGN.md 5.5) and
 * remembers which requests stopped waiting while the Inbox showed them
 * (answered here, answered elsewhere, expired, withdrawn), so they stay in
 * place with what happened instead of vanishing under a finger. In memory
 * only: a relaunch starts empty (the sheet then shows "Request Unavailable").
 */

export interface CachedInteraction {
  interaction: InboxInteractionDto;
  /** The project the Inbox matched it to, for the sheet's context line. */
  projectName: string | null;
}

export type RequestAnswer = "approve" | "deny" | "yes" | "no" | "reply";

/**
 * Why a request the Inbox shows stopped waiting: answered here, answered
 * here without a connection (the answer waits in the retry queue), answered
 * on another device (with History's word for the answer, "Approved", when
 * the server gave it), past its expiry, withdrawn by whoever asked, or gone
 * for a reason the app could not learn.
 */
export type RequestOutcome =
  | { kind: "answered"; answer: RequestAnswer }
  | { kind: "queued"; answer: RequestAnswer }
  | { kind: "answeredElsewhere"; result: string }
  | { kind: "expired" }
  | { kind: "withdrawn" }
  | { kind: "gone" };

/** A request that stopped waiting while on screen, still shown in place in the Inbox. */
export interface SettledRequest {
  interaction: InboxInteractionDto;
  outcome: RequestOutcome;
}

const interactions = new Map<string, CachedInteraction>();
/** Answers given here that wait in the retry queue, until it sends or drops them. */
const queuedAnswers = new Map<
  string,
  { interaction: InboxInteractionDto; answer: RequestAnswer }
>();
const drafts = new Map<string, string>();
let handled: ReadonlySet<string> = new Set();
let settled: ReadonlyMap<string, SettledRequest> = new Map();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Called by the Inbox right before it opens the Reply sheet. */
export function rememberInteraction(
  interaction: InboxInteractionDto,
  projectName: string | null,
): void {
  interactions.set(interaction.id, { interaction, projectName });
}

export function cachedInteraction(id: string): CachedInteraction | null {
  return interactions.get(id) ?? null;
}

/**
 * Called once a response was sent (or queued) for this request. The Inbox
 * keeps the row where it is and shows the answer in place of its buttons
 * until `clearSettledRequests()`.
 */
export function markInteractionHandled(
  interaction: InboxInteractionDto,
  answer: RequestAnswer,
): void {
  const { id } = interaction;
  if (handled.has(id)) return;
  handled = new Set([...handled, id]);
  settled = new Map([...settled, [id, { interaction, outcome: { kind: "answered", answer } }]]);
  interactions.delete(id);
  drafts.delete(id);
  notify();
}

/**
 * Called when an answer given here got no response from the server and
 * waits in the retry queue: the row keeps its place and says it will be
 * sent; once the queue sends it (or the server refuses it) the row shows
 * what really happened (`onQueuedResponseDone` below).
 */
export function markInteractionQueued(
  interaction: InboxInteractionDto,
  answer: RequestAnswer,
): void {
  const { id } = interaction;
  if (handled.has(id)) return;
  handled = new Set([...handled, id]);
  settled = new Map([...settled, [id, { interaction, outcome: { kind: "queued", answer } }]]);
  queuedAnswers.set(id, { interaction, answer });
  interactions.delete(id);
  drafts.delete(id);
  notify();
}

/** A row still on screen takes its real outcome (a queued answer resolved). */
function resettle(request: SettledRequest): void {
  if (!settled.has(request.interaction.id)) return;
  settled = new Map([...settled, [request.interaction.id, request]]);
  notify();
}

/**
 * The server refused a queued answer: if the request still waits (it
 * changed), the answer didn't count and its buttons come back; else the row
 * says how it closed (answered on another device, expired, withdrawn).
 */
async function settleRefused(interaction: InboxInteractionDto): Promise<void> {
  const open = await api.listPendingInteractions().then(
    (result) => result.interactions,
    () => null,
  );
  if (open?.some((item) => item.id === interaction.id)) {
    handled = new Set([...handled].filter((id) => id !== interaction.id));
    settled = new Map([...settled].filter(([id]) => id !== interaction.id));
    notify();
    return;
  }
  const [closed] = await outcomesOf([interaction], Date.now());
  if (closed) resettle(closed);
}

onQueuedResponseDone((id, delivered) => {
  const queued = queuedAnswers.get(id);
  if (!queued) return;
  queuedAnswers.delete(id);
  if (delivered) {
    resettle({
      interaction: queued.interaction,
      outcome: { kind: "answered", answer: queued.answer },
    });
  } else {
    void settleRefused(queued.interaction);
  }
});

/**
 * Requests that left the server's open list while the Inbox showed them
 * (answered on another device, expired, withdrawn): they stay in place like
 * the ones answered here, with what happened.
 */
export function settleRequests(requests: readonly SettledRequest[]): void {
  const fresh = requests.filter(({ interaction }) => !settled.has(interaction.id));
  if (fresh.length === 0) return;
  settled = new Map([
    ...settled,
    ...fresh.map((request) => [request.interaction.id, request] as const),
  ]);
  notify();
}

/**
 * Takes the settled rows out of the Inbox. Only while nobody can tap them:
 * the Inbox is out of sight, or after a pull to refresh.
 */
export function clearSettledRequests(): void {
  if (settled.size === 0) return;
  settled = new Map();
  notify();
}

/**
 * A request that leaves the open list within this long of its expiry
 * expired (the server's clock decides, and the two clocks differ a little).
 */
const EXPIRY_SLACK_MS = 60_000;

/**
 * What happened to requests that left the server's open list: past their
 * expiry, answered (History's response feed has the answer, but not where
 * it was given), else withdrawn by whoever asked. Without the feed it
 * can't tell answered from withdrawn.
 */
export async function outcomesOf(
  vanished: readonly InboxInteractionDto[],
  now: number,
): Promise<SettledRequest[]> {
  const expired = (item: InboxInteractionDto) =>
    Date.parse(item.expiresAt) <= now + EXPIRY_SLACK_MS;
  let answers: Map<string, string | null> | null = new Map();
  if (vanished.some((item) => !expired(item))) {
    answers = await api.listActivityFeed("response", 0).then(
      (page) => new Map(page.items.map((entry) => [entry.id, entry.result])),
      () => null,
    );
  }
  return vanished.map((interaction): SettledRequest => {
    const result = answers?.get(`response:${interaction.id}`);
    if (result) return { interaction, outcome: { kind: "answeredElsewhere", result } };
    if (expired(interaction)) return { interaction, outcome: { kind: "expired" } };
    return { interaction, outcome: { kind: answers ? "withdrawn" : "gone" } };
  });
}

/**
 * Sends an answer given in the app (the Inbox's buttons, the Reply sheet)
 * straight to the server first: the person is looking at the request and
 * should learn at once whether the answer counted (R3-02). Resolves "sent";
 * "taken" when the server says the request already closed (answered on
 * another device, withdrawn, expired: ask `outcomesOf` which); "queued"
 * when no response came back at all (no connection, timed out): the answer
 * goes to the retry queue that notification actions use and is sent when
 * the connection is back, as before the redesign. Any other server
 * response throws.
 */
export async function sendAnswer(
  interaction: InboxInteractionDto,
  answer: { action: Exclude<RequestAnswer, "reply"> } | { action: "reply"; response: string },
): Promise<"sent" | "taken" | "queued"> {
  const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!deviceId) throw new Error("This device isn’t registered with Hark.");
  try {
    await api.respondToInteraction(interaction.id, {
      ...answer,
      actionDigest: interaction.actionDigest,
      deviceId,
    });
    return "sent";
  } catch (error) {
    // No HTTP response (an ApiError always has one): keep the answer.
    if (!(error instanceof ApiError)) {
      await queueInteractionResponse(interaction.id, {
        ...answer,
        actionDigest: interaction.actionDigest,
      });
      return "queued";
    }
    // 409 "already terminal" (the other 409 is a changed request, an error).
    const taken =
      error instanceof ApiError &&
      (error.status === 404 || (error.status === 409 && /terminal/i.test(error.message)));
    if (taken) return "taken";
    throw error;
  }
}

/** An unsent reply, kept per request so closing the sheet never loses it. */
export function replyDraft(id: string): string {
  return drafts.get(id) ?? "";
}

export function saveReplyDraft(id: string, text: string): void {
  const had = drafts.has(id);
  if (text.trim()) drafts.set(id, text);
  else drafts.delete(id);
  // The Inbox row says when a draft waits (P2-07); only its presence matters.
  if (had !== drafts.has(id)) notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current sets, for callbacks that run outside a render (the Inbox's refresh). */
export function currentHandledIds(): ReadonlySet<string> {
  return handled;
}

export function currentSettledRequests(): ReadonlyMap<string, SettledRequest> {
  return settled;
}

/** IDs answered in this session; the Inbox leaves them out of the server's list. */
export function useHandledInteractionIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => handled);
}

/** Whether an unsent reply is saved for this request. */
export function useHasReplyDraft(id: string): boolean {
  return useSyncExternalStore(subscribe, () => drafts.has(id));
}

/** Requests that stopped waiting while on screen and still show in place, with what happened. */
export function useSettledRequests(): ReadonlyMap<string, SettledRequest> {
  return useSyncExternalStore(subscribe, () => settled);
}

import type { InboxInteractionDto } from "@hark/contracts";
import { useSyncExternalStore } from "react";

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
 * Why a request the Inbox shows stopped waiting: answered here, answered on
 * another device (with History's word for the answer, "Approved", when the
 * server gave it), past its expiry, withdrawn by whoever asked, or gone for
 * a reason the app could not learn.
 */
export type RequestOutcome =
  | { kind: "answered"; answer: RequestAnswer }
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

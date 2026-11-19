import type { InboxInteractionDto } from "@hark/contracts";
import { useSyncExternalStore } from "react";

/**
 * Hands a request from the Inbox to the Reply sheet (DESIGN.md 5.5) and
 * remembers which requests were answered here, so an answer shows in the
 * Inbox at once instead of on the next refresh. In memory only: a relaunch
 * starts empty (the sheet then shows "Request Unavailable").
 */

export interface CachedInteraction {
  interaction: InboxInteractionDto;
  /** The project the Inbox matched it to, for the sheet's context line. */
  projectName: string | null;
}

export type RequestAnswer = "approve" | "deny" | "yes" | "no" | "reply";

/** A request answered in this session, still shown in place in the Inbox. */
export interface AnsweredRequest {
  interaction: InboxInteractionDto;
  answer: RequestAnswer;
}

const interactions = new Map<string, CachedInteraction>();
const drafts = new Map<string, string>();
let handled: ReadonlySet<string> = new Set();
let answered: ReadonlyMap<string, AnsweredRequest> = new Map();
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
 * until `clearAnsweredRequests()`.
 */
export function markInteractionHandled(
  interaction: InboxInteractionDto,
  answer: RequestAnswer,
): void {
  const { id } = interaction;
  if (handled.has(id)) return;
  handled = new Set([...handled, id]);
  answered = new Map([...answered, [id, { interaction, answer }]]);
  interactions.delete(id);
  drafts.delete(id);
  notify();
}

/**
 * Takes the answered rows out of the Inbox. Only while nobody can tap them:
 * the Inbox is out of sight, or after a pull to refresh.
 */
export function clearAnsweredRequests(): void {
  if (answered.size === 0) return;
  answered = new Map();
  notify();
}

/** An unsent reply, kept per request so closing the sheet never loses it. */
export function replyDraft(id: string): string {
  return drafts.get(id) ?? "";
}

export function saveReplyDraft(id: string, text: string): void {
  if (text.trim()) drafts.set(id, text);
  else drafts.delete(id);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** IDs answered in this session; the Inbox leaves them out of the server's list. */
export function useHandledInteractionIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => handled);
}

/** Requests answered in this session that the Inbox still shows with their answer. */
export function useAnsweredRequests(): ReadonlyMap<string, AnsweredRequest> {
  return useSyncExternalStore(subscribe, () => answered);
}

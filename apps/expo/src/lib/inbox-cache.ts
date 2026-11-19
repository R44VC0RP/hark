import type { InboxInteractionDto } from "@hark/contracts";
import { useSyncExternalStore } from "react";

/**
 * Hands a request from the Inbox to the Reply sheet (DESIGN.md 5.5) and
 * remembers which requests were answered here, so a sent reply disappears
 * from the Inbox at once instead of on the next refresh. In memory only: a
 * relaunch starts empty (the sheet then shows "Request Unavailable").
 */

export interface CachedInteraction {
  interaction: InboxInteractionDto;
  /** The project the Inbox matched it to, for the sheet's context line. */
  projectName: string | null;
}

const interactions = new Map<string, CachedInteraction>();
let handled: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

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

/** Called once a response was sent (or queued) for this request. */
export function markInteractionHandled(id: string): void {
  if (handled.has(id)) return;
  handled = new Set([...handled, id]);
  interactions.delete(id);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** IDs answered in this session; the Inbox filters them out of "Needs You". */
export function useHandledInteractionIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => handled);
}

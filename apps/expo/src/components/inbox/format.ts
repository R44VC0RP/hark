import type { InboxActivityKind, InboxProjectSummaryDto } from "@hark/contracts";

/**
 * A request's answer as History words it ("Approved", "Denied", "Yes",
 * "No", "Replied"), so the Inbox and History say the same thing.
 */
export const ANSWER_LABELS = {
  approve: "Approved",
  deny: "Denied",
  yes: "Yes",
  no: "No",
  reply: "Replied",
} as const;

/** Denied and No read as a refusal, not a success: no green check (V-10). */
export function isRefusal(result: string): boolean {
  return result === ANSWER_LABELS.deny || result === ANSWER_LABELS.no;
}

export function activityKindLabel(kind: InboxActivityKind): string {
  if (kind === "live_activity") return "Live Activity";
  if (kind === "response") return "Response";
  return "Notification";
}

/**
 * The project a request or Live Activity belongs to: its project ID, else a
 * project named like its source (case-insensitive). The server's unfiled
 * project is not a name worth showing.
 */
export function projectNameFor(
  item: { projectId?: string | null; sourceName: string },
  projects: InboxProjectSummaryDto[],
): string | null {
  const byId =
    item.projectId != null
      ? projects.find((project) => project.projectId === item.projectId)
      : undefined;
  const match =
    byId ??
    projects.find((project) => project.name.toLowerCase() === item.sourceName.toLowerCase());
  if (!match?.projectId) return null;
  // "Fieldnotes Shop · Fieldnotes Shop" says nothing twice.
  return match.name.toLowerCase() === item.sourceName.toLowerCase() ? null : match.name;
}

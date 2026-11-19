import type { InboxActivityKind, InboxProjectSummaryDto } from "@hark/contracts";

/** "now", "2m", "3h", "1d": the trailing time on Inbox rows. */
export function relativeTime(value: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** "13 min left", "5 hours left", "7 days left" until a request expires. */
export function timeRemaining(value: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.ceil((new Date(value).getTime() - now) / 60_000));
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} left`;
  const days = Math.ceil(hours / 24);
  return `${days} days left`;
}

/** The spoken form of `timeRemaining`, for VoiceOver ("13 minutes left"). */
export function timeRemainingSpoken(value: string, now = Date.now()): string {
  return timeRemaining(value, now).replace(" min ", " minutes ");
}

export function activityKindLabel(kind: InboxActivityKind): string {
  if (kind === "live_activity") return "Live Activity";
  if (kind === "response") return "Response";
  return "Notification";
}

/** Today's activity shows the time, older activity the date. */
export function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
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

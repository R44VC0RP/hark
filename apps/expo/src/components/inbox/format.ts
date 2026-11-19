import type { InboxActivityKind, InboxProjectSummaryDto } from "@hark/contracts";
import type { SFSymbol } from "expo-symbols";
import type { RequestOutcome } from "../../lib/inbox-cache";

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

/**
 * What a request that stopped waiting says where its countdown and buttons
 * were: the answer, worded as History words it ("Approved", "Yes"), or why
 * it closed ("Expired", "Withdrawn"), with a short note so the countdown's
 * line never stays empty (R3V-04). Answers keep the check (green) or cross
 * (grey) of V-10; closings are grey.
 */
export function outcomeLine(outcome: RequestOutcome): {
  text: string;
  symbol: SFSymbol;
  done: boolean;
  note: string;
} {
  const answer = (result: string, note: string) =>
    isRefusal(result)
      ? { text: result, symbol: "xmark.circle.fill" as const, done: false, note }
      : { text: result, symbol: "checkmark.circle.fill" as const, done: true, note };
  switch (outcome.kind) {
    case "answered":
      return answer(
        ANSWER_LABELS[outcome.answer],
        outcome.answer === "reply" ? "Reply sent" : "Answer sent",
      );
    case "answeredElsewhere":
      return answer(outcome.result, "Answered on another device");
    case "expired":
      return {
        text: "Expired",
        symbol: "clock.badge.xmark.fill",
        done: false,
        note: "No answer was sent",
      };
    case "withdrawn":
      return {
        text: "Withdrawn",
        symbol: "minus.circle.fill",
        done: false,
        note: "No answer is needed",
      };
    case "gone":
      return {
        text: "No longer waiting",
        symbol: "minus.circle.fill",
        done: false,
        note: "Answered or withdrawn elsewhere",
      };
  }
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

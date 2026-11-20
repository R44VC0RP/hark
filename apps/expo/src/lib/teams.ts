import {
  API_ERROR_CODE_SEAT_LIMIT,
  type AppDto,
  HARK_PAGE_CATEGORY_ID,
  type OncallGroupDto,
  type OncallPageDto,
  type OncallPageEventDto,
  type OncallShiftDto,
  oncallPageClaimedPushDataSchema,
  oncallPagePushDataSchema,
  type TeamDto,
  type TeamRole,
  type TeamSummaryDto,
} from "@hark/contracts";
import { ApiError } from "./api-error";
import { formatTimeUntil } from "./dates";

/**
 * Pure helpers for teams and on-call. Kept free of React Native imports so
 * they stay unit-testable.
 */

/** A bare 404 without a server code: the server predates teams / on-call. */
export function isUnsupportedRoute(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === undefined;
}

export function isSeatLimitError(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.code === API_ERROR_CODE_SEAT_LIMIT || error.status === 402)
  );
}

export interface TeamSection {
  team: TeamSummaryDto;
  memberCount: number | null;
  apps: AppDto[];
}

/**
 * Splits apps into the viewer's own and one section per team. Teams keep the
 * server's order, appear even without apps (so a just-joined team is
 * visible), and teams known only from an app (a race with the team list) are
 * appended.
 */
export function groupAppsByTeam(
  apps: AppDto[],
  teams: Pick<TeamDto, "id" | "name" | "memberCount">[],
): { personal: AppDto[]; teams: TeamSection[] } {
  const personal: AppDto[] = [];
  const sections = new Map<string, TeamSection>();
  for (const team of teams) {
    sections.set(team.id, {
      team: { id: team.id, name: team.name },
      memberCount: team.memberCount,
      apps: [],
    });
  }
  for (const app of apps) {
    if (!app.team) {
      personal.push(app);
      continue;
    }
    let section = sections.get(app.team.id);
    if (!section) {
      section = { team: app.team, memberCount: null, apps: [] };
      sections.set(app.team.id, section);
    }
    section.apps.push(app);
  }
  return { personal, teams: [...sections.values()] };
}

export function memberCountLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

export function seatsLabel(seats: TeamDto["seats"]): string {
  return seats.used === 1 ? "1 seat" : `${seats.used} seats`;
}

/** No seat for another person: a team without the Team plan has 0 seats to fill. */
export function seatsFull(seats: TeamDto["seats"]): boolean {
  return seats.available !== null && seats.used >= seats.available;
}

export function roleLabel(role: TeamRole): string {
  return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member";
}

export function canManageTeam(role: TeamRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** The shift covering `now`, if any. */
export function currentShift<T extends OncallShiftDto>(shifts: T[], now = Date.now()): T | null {
  return (
    shifts.find((shift) => Date.parse(shift.startsAt) <= now && now < Date.parse(shift.endsAt)) ??
    null
  );
}

/** Pages nobody has acknowledged yet. */
export function pagesNeedingResponse(pages: OncallPageDto[]): OncallPageDto[] {
  return pages.filter((page) => page.status === "triggered");
}

export function pagesNeedYouLabel(count: number): string {
  return count === 1 ? "1 page needs you" : `${count} pages need you`;
}

export function pageStatusLabel(page: Pick<OncallPageDto, "status">): string {
  return page.status === "triggered"
    ? "Open"
    : page.status === "acknowledged"
      ? "Acknowledged"
      : "Resolved";
}

export function escalationLabel(
  page: Pick<
    OncallPageDto,
    "status" | "escalationStep" | "nextEscalationAt" | "acknowledgedBy" | "resolvedBy"
  >,
  now = Date.now(),
): string {
  if (page.status === "resolved") {
    return page.resolvedBy ? `Resolved by ${page.resolvedBy.name}` : "Resolved";
  }
  if (page.status === "acknowledged") {
    return page.acknowledgedBy ? `Acknowledged by ${page.acknowledgedBy.name}` : "Acknowledged";
  }
  const step = page.escalationStep > 0 ? `Escalated ${page.escalationStep}×` : "Not escalated";
  if (!page.nextEscalationAt) return `${step} · no further steps`;
  return `${step} · next ${formatTimeUntil(page.nextEscalationAt, now)}`;
}

/** Keeps a phrase on one line ("Priya Shah"), so wrapped text breaks between phrases. */
export function unbroken(text: string): string {
  return text.replace(/ /g, "\u00A0");
}

/**
 * One timeline line in plain words: "Paged Ana", "Escalated to Ben",
 * "Cal escalated to Ben", "Paged Ana again" (the policy started over),
 * "Acknowledged by Ben". No "level 1, loop 2" jargon (V-17).
 */
export function timelineLabel(event: OncallPageEventDto): string {
  // A name never breaks across lines (no-break spaces); a list wraps between names.
  const names = event.people.map((person) => unbroken(person.name)).join(", ");
  if (event.kind === "acknowledged") return `Acknowledged by ${names}`;
  if (event.kind === "resolved") return `Resolved by ${names}`;
  const who = names || "nobody";
  const again = event.loop ? " again" : "";
  if (event.escalatedBy) return `${event.escalatedBy.name} escalated to ${who}${again}`;
  if (event.level) return `Escalated to ${who}${again}`;
  return `Paged ${who}${again}`;
}

/** Readable escalation policy: "On call → 5 min → Next in rotation → 10 min → Everyone in the group". */
export function escalationPolicySummary(
  group: Pick<
    OncallGroupDto,
    "escalation" | "escalationMode" | "escalationLoops" | "escalationFinal"
  >,
  nameOf: (userId: string) => string = (id) => id,
  groupNameOf: (groupId: string) => string = () => "another group",
): string {
  const target = (step: OncallGroupDto["escalation"][number]): string => {
    switch (step.target) {
      case "next":
        return "Next in rotation";
      case "oncall":
        return step.groupId ? `On call in ${groupNameOf(step.groupId)}` : "Whoever is on call";
      case "people":
        return (step.userIds ?? []).map(nameOf).join(" + ");
      case "group":
        return "Everyone in the group";
      case "team":
        return "Everyone in the team";
    }
  };
  const parts = ["On call"];
  for (const step of group.escalation) parts.push(`${step.afterMinutes} min`, target(step));
  let summary = parts.join(" → ");
  if (group.escalationLoops) summary += ` · repeats ${group.escalationLoops}×`;
  if (group.escalationFinal === "group") summary += " · then everyone in the group";
  if (group.escalationFinal === "team") summary += " · then everyone in the team";
  if (group.escalationMode === "hand_off") summary += " · hands off";
  return summary;
}

/** Pulls the join code out of `hark://join/<code>` or `https://…/join/<code>`. */
export function joinCodeFromUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // `hark://join/abc` parses with host "join"; web links carry it in the path.
  const segments =
    url.protocol === "hark:"
      ? [url.host, ...url.pathname.split("/")].filter(Boolean)
      : url.protocol === "https:"
        ? url.pathname.split("/").filter(Boolean)
        : [];
  if (segments.length !== 2 || segments[0] !== "join") return null;
  const code = segments[1] ?? "";
  return /^[A-Za-z0-9_-]{4,128}$/.test(code) ? code : null;
}

export interface PagePush {
  pageId: string;
  responseToken?: string;
}

/** Recognizes an on-call page push (category HARK_PAGE_V1). */
export function pagePushData(data: unknown): PagePush | null {
  if (typeof data !== "object" || data === null) return null;
  if ((data as { categoryId?: unknown }).categoryId !== HARK_PAGE_CATEGORY_ID) return null;
  const parsed = oncallPagePushDataSchema.safeParse(data);
  if (!parsed.success) return null;
  return {
    pageId: parsed.data.pageId,
    ...(parsed.data.responseToken ? { responseToken: parsed.data.responseToken } : {}),
  };
}

/** Recognizes the silent `page.claimed` command. */
export function claimedPageId(candidate: unknown): string | null {
  const parsed = oncallPageClaimedPushDataSchema.safeParse(candidate);
  return parsed.success ? parsed.data.pageId : null;
}

/** SecureStore key holding an invite code opened while signed out. */
export const PENDING_JOIN_CODE_KEY = "hark.team.pendingJoinCode";

/** Where team owners start the Team plan (billing lives on the web). */
export const TEAM_BILLING_URL = "https://hark.fyi/dashboard";

type PageClaimedListener = (pageId: string) => void;
const pageClaimedListeners = new Set<PageClaimedListener>();

/** Lets open screens refresh when another responder claims a page. */
export function onPageClaimed(listener: PageClaimedListener): () => void {
  pageClaimedListeners.add(listener);
  return () => pageClaimedListeners.delete(listener);
}

export function emitPageClaimed(pageId: string): void {
  for (const listener of pageClaimedListeners) {
    try {
      listener(pageId);
    } catch {
      // A failing screen must not block the others.
    }
  }
}

/** First letter for an avatar fallback. */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

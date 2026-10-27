import type * as Contracts from "@hark/contracts";
import type { AppDto, TeamDto, TeamRole } from "@hark/contracts";

export { TEAM_FREE_SEATS, TEAM_SEAT_PRICE_MONTHLY } from "../../shared/pricing";

// Contract constants mirrored as typed literals; importing the values would
// bundle zod into the client.
export const TEAM_NAME_MAX_CHARS: typeof Contracts.TEAM_NAME_MAX_CHARS = 60;
export const MAX_ESCALATION_STEPS: typeof Contracts.MAX_ESCALATION_STEPS = 5;
export const ONCALL_RING_INTERVAL_MIN_SECONDS: typeof Contracts.ONCALL_RING_INTERVAL_MIN_SECONDS = 30;
export const ONCALL_RING_INTERVAL_MAX_SECONDS: typeof Contracts.ONCALL_RING_INTERVAL_MAX_SECONDS = 300;
export const ONCALL_RING_INTERVAL_DEFAULT_SECONDS: typeof Contracts.ONCALL_RING_INTERVAL_DEFAULT_SECONDS = 60;
export const ONCALL_RING_MAX_REPEATS_LIMIT: typeof Contracts.ONCALL_RING_MAX_REPEATS_LIMIT = 30;
export const ONCALL_RING_MAX_REPEATS_DEFAULT: typeof Contracts.ONCALL_RING_MAX_REPEATS_DEFAULT = 10;
export const API_ERROR_CODE_SEAT_LIMIT: typeof Contracts.API_ERROR_CODE_SEAT_LIMIT = "seat_limit";

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** "a member", "an admin", "an owner". */
export function withArticle(role: TeamRole): string {
  const label = ROLE_LABELS[role].toLowerCase();
  return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`;
}

/** Owners and admins manage members, invites and on-call groups. */
export function canManage(role: TeamRole): boolean {
  return role === "owner" || role === "admin";
}

/** "3 of 5 seats", or "3 seats" when the plan has no fixed cap. */
export function seatsLabel(team: TeamDto): string {
  const { used, available } = team.seats;
  if (available === null) return `${used} ${used === 1 ? "seat" : "seats"}`;
  return `${used} of ${available} ${available === 1 ? "seat" : "seats"}`;
}

/** No seat left for the next person to join. */
export function seatsFull(team: TeamDto): boolean {
  return team.seats.available !== null && team.seats.used >= team.seats.available;
}

export function teamSummary(team: TeamDto): string {
  return [
    ROLE_LABELS[team.role],
    `${team.memberCount} ${team.memberCount === 1 ? "member" : "members"}`,
    seatsLabel(team),
    ...(team.oncallGroupCount > 0
      ? [`${team.oncallGroupCount} on-call ${team.oncallGroupCount === 1 ? "group" : "groups"}`]
      : []),
  ].join(" · ");
}

/**
 * Whether the viewer added this team app. The contract only carries the
 * adder's display name, so this compares names; the server still decides.
 */
export function addedByViewer(app: AppDto, viewerName: string | null | undefined): boolean {
  return Boolean(app.addedBy && viewerName && app.addedBy === viewerName);
}

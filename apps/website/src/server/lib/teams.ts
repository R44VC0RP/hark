import {
  sanitizeDisplayText,
  type TeamDto,
  type TeamInviteDto,
  type TeamMemberDto,
  type TeamRole,
} from "@hark/contracts";
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "../db";
import {
  agentNotification,
  app,
  appMemberState,
  device,
  oncallGroup,
  oncallOverride,
  team,
  teamInvite,
  teamMember,
  user as userTable,
} from "../db/schema";
import { newId } from "./id";
import { buildPushMessages, sendPushMessages } from "./push";
import { syncTeamSeats, teamIsActive, teamSeats } from "./team-billing";

export type TeamRow = typeof team.$inferSelect;
export type InviteRow = typeof teamInvite.$inferSelect;

const ROLE_RANK: Record<TeamRole, number> = { member: 1, admin: 2, owner: 3 };

export function hasRole(role: TeamRole, minimum: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export interface Membership {
  team: TeamRow;
  role: TeamRole;
}

/** The team and the user's role in it, or undefined when they are not a member. */
export async function membership(teamId: string, userId: string): Promise<Membership | undefined> {
  const [row] = await db
    .select({ team, role: teamMember.role })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .limit(1);
  return row ? { team: row.team, role: row.role as TeamRole } : undefined;
}

export async function memberCount(teamId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(teamMember)
    .where(eq(teamMember.teamId, teamId));
  return row?.value ?? 0;
}

export async function memberIds(teamId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .where(eq(teamMember.teamId, teamId));
  return rows.map((row) => row.userId);
}

/** Billing contact for the team's Autumn customer. */
export async function billingCustomer(teamRow: TeamRow) {
  const [owner] = await db
    .select({ email: userTable.email })
    .from(teamMember)
    .innerJoin(userTable, eq(userTable.id, teamMember.userId))
    .where(and(eq(teamMember.teamId, teamRow.id), eq(teamMember.role, "owner")))
    .limit(1);
  return { id: teamRow.id, name: teamRow.name, ...(owner ? { email: owner.email } : {}) };
}

/** Team-wide "added an app" pushes one person can cause per hour. */
const SHARE_NOTICES_PER_HOUR = 10;
/** Once per app and team per day, so moving an app back and forth can't spam. */
const SHARE_NOTICE_REPEAT_MS = 86_400_000;
const shareNoticeBuckets = new Map<string, { count: number; resetAt: number }>();
const shareNoticesSent = new Map<string, number>();

/**
 * Whether an "added an app" push to the whole team may go out. Each one can
 * reach every member's iPhones, so it is capped per person and per app.
 */
export function shareNoticeAllowed(actorId: string, appId: string, teamId: string): boolean {
  const now = Date.now();
  if (shareNoticesSent.size > 10_000) {
    for (const [key, at] of shareNoticesSent) {
      if (now - at > SHARE_NOTICE_REPEAT_MS) shareNoticesSent.delete(key);
    }
  }
  const key = `${appId}:${teamId}`;
  const last = shareNoticesSent.get(key);
  if (last !== undefined && now - last < SHARE_NOTICE_REPEAT_MS) return false;
  const bucket = shareNoticeBuckets.get(actorId);
  if (!bucket || bucket.resetAt <= now) {
    if (shareNoticeBuckets.size > 10_000) {
      for (const [id, entry] of shareNoticeBuckets) {
        if (entry.resetAt <= now) shareNoticeBuckets.delete(id);
      }
    }
    shareNoticeBuckets.set(actorId, { count: 1, resetAt: now + 3_600_000 });
  } else {
    if (bucket.count >= SHARE_NOTICES_PER_HOUR) return false;
    bucket.count += 1;
  }
  shareNoticesSent.set(key, now);
  return true;
}

/** Shown (with code `seat_limit`) when a team without the Team plan tries a team feature. */
export const TEAM_PLAN_REQUIRED_MESSAGE =
  "This team needs the Team plan ($5 per seat per month) to add people, share apps and page.";

/** Whether the team's features work (see `teamIsActive`). */
export async function teamActive(teamId: string): Promise<boolean> {
  const [row] = await db.select().from(team).where(eq(team.id, teamId)).limit(1);
  if (!row) return false;
  return teamIsActive(await billingCustomer(row));
}

const seatSyncs = new Map<string, Promise<void>>();

/**
 * Reports the team's current member count to billing. Syncs for one team run
 * one after another and each reads the count when it starts, so concurrent
 * joins and leaves always end with the final count.
 */
export function syncSeats(teamRow: TeamRow): void {
  const next = (seatSyncs.get(teamRow.id) ?? Promise.resolve())
    .then(async () => syncTeamSeats(await billingCustomer(teamRow), await memberCount(teamRow.id)))
    .catch((error: unknown) => console.error("[teams] Seat sync failed", error));
  seatSyncs.set(teamRow.id, next);
  void next.then(() => {
    if (seatSyncs.get(teamRow.id) === next) seatSyncs.delete(teamRow.id);
  });
}

export async function toTeamDto(teamRow: TeamRow, role: TeamRole): Promise<TeamDto> {
  const [[members], [apps], [groups]] = await Promise.all([
    db.select({ value: count() }).from(teamMember).where(eq(teamMember.teamId, teamRow.id)),
    db.select({ value: count() }).from(app).where(eq(app.teamId, teamRow.id)),
    db.select({ value: count() }).from(oncallGroup).where(eq(oncallGroup.teamId, teamRow.id)),
  ]);
  const used = members?.value ?? 0;
  const billing = await teamSeats(await billingCustomer(teamRow), used);
  return {
    id: teamRow.id,
    name: teamRow.name,
    role,
    memberCount: used,
    appCount: apps?.value ?? 0,
    oncallGroupCount: groups?.value ?? 0,
    ...billing,
    createdAt: teamRow.createdAt.toISOString(),
  };
}

export async function listTeams(userId: string): Promise<TeamDto[]> {
  const rows = await db
    .select({ team, role: teamMember.role })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(eq(teamMember.userId, userId))
    .orderBy(asc(team.name), asc(team.id));
  return Promise.all(rows.map((row) => toTeamDto(row.team, row.role as TeamRole)));
}

export async function listMembers(teamId: string): Promise<TeamMemberDto[]> {
  const rows = await db
    .select({ member: teamMember, user: userTable })
    .from(teamMember)
    .innerJoin(userTable, eq(userTable.id, teamMember.userId))
    .where(eq(teamMember.teamId, teamId))
    .orderBy(asc(teamMember.joinedAt), asc(userTable.name));
  const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  return rows
    .map(
      ({ member, user }): TeamMemberDto => ({
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: member.role as TeamRole,
        joinedAt: member.joinedAt.toISOString(),
      }),
    )
    .sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
}

export async function memberDto(
  teamId: string,
  userId: string,
): Promise<TeamMemberDto | undefined> {
  return (await listMembers(teamId)).find((member) => member.userId === userId);
}

export function toInviteDto(row: InviteRow): TeamInviteDto {
  return {
    id: row.id,
    teamId: row.teamId,
    email: row.email,
    role: row.role as TeamRole,
    invitedBy: row.invitedByName,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Moves a team app back to the member who added it, keeping their own sign-in state. */
export function returnAppToAdder(tx: Tx, row: typeof app.$inferSelect) {
  const state = tx
    .select()
    .from(appMemberState)
    .where(and(eq(appMemberState.appId, row.id), eq(appMemberState.userId, row.userId)))
    .get();
  tx.update(app)
    .set({
      teamId: null,
      shareName: state?.shareName ?? row.shareName,
      shareEmail: state?.shareEmail ?? row.shareEmail,
      consentedAt: state ? state.consentedAt : row.consentedAt,
      lastOpenedAt: state ? state.lastOpenedAt : row.lastOpenedAt,
      updatedAt: new Date(),
    })
    .where(eq(app.id, row.id))
    .run();
  tx.delete(appMemberState).where(eq(appMemberState.appId, row.id)).run();
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Revokes the open invites a user minted for a team (they lost the right to invite). */
export function revokeInvitesBy(executor: Tx | typeof db, teamId: string, userId: string): void {
  executor
    .update(teamInvite)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(teamInvite.teamId, teamId),
        eq(teamInvite.invitedByUserId, userId),
        isNull(teamInvite.acceptedAt),
        isNull(teamInvite.revokedAt),
      ),
    )
    .run();
}

/**
 * Removes a member and everything that only made sense while they belonged:
 * their sign-in state for the team's apps (so no further pass is issued),
 * their place in on-call rotations, and their overrides.
 */
export function removeMember(teamId: string, userId: string): boolean {
  return db.transaction((tx) => {
    const removed = tx
      .delete(teamMember)
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
      .returning({ userId: teamMember.userId })
      .all();
    if (removed.length === 0) return false;
    revokeInvitesBy(tx, teamId, userId);
    const teamApps = tx.select({ id: app.id }).from(app).where(eq(app.teamId, teamId));
    tx.delete(appMemberState)
      .where(and(eq(appMemberState.userId, userId), inArray(appMemberState.appId, teamApps)))
      .run();
    const groups = tx.select().from(oncallGroup).where(eq(oncallGroup.teamId, teamId)).all();
    const now = new Date();
    for (const group of groups) {
      if (group.memberIds.includes(userId)) {
        tx.update(oncallGroup)
          .set({ memberIds: group.memberIds.filter((id) => id !== userId), updatedAt: now })
          .where(eq(oncallGroup.id, group.id))
          .run();
      }
    }
    if (groups.length > 0) {
      tx.delete(oncallOverride)
        .where(
          and(
            eq(oncallOverride.userId, userId),
            inArray(
              oncallOverride.groupId,
              groups.map((group) => group.id),
            ),
          ),
        )
        .run();
    }
    return true;
  });
}

/** Deletes a team; its apps go back to the members who added them. */
export function deleteTeam(teamId: string): boolean {
  return db.transaction((tx) => {
    for (const row of tx.select().from(app).where(eq(app.teamId, teamId)).all()) {
      returnAppToAdder(tx, row);
    }
    const deleted = tx.delete(team).where(eq(team.id, teamId)).returning({ id: team.id }).all();
    return deleted.length > 0;
  });
}

/**
 * Takes a user out of every team before their account is deleted, so no team
 * is left without an owner: a team they are alone in is deleted; a team they
 * own passes to its longest-serving admin, else its longest-serving member;
 * then the usual member cleanup runs (rotations, overrides, app state, their
 * open invites).
 */
export async function releaseTeamsOf(userId: string): Promise<void> {
  const memberships = await db
    .select({ teamId: teamMember.teamId, role: teamMember.role })
    .from(teamMember)
    .where(eq(teamMember.userId, userId));
  for (const { teamId, role } of memberships) {
    const others = await db
      .select({ userId: teamMember.userId, role: teamMember.role })
      .from(teamMember)
      .where(and(eq(teamMember.teamId, teamId), ne(teamMember.userId, userId)))
      .orderBy(asc(teamMember.joinedAt), asc(teamMember.userId));
    if (others.length === 0) {
      deleteTeam(teamId);
      continue;
    }
    if (role === "owner") {
      const successor = others.find((other) => other.role === "admin") ?? others[0];
      if (successor) {
        await db
          .update(teamMember)
          .set({ role: "owner" })
          .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, successor.userId)));
      }
    }
    removeMember(teamId, userId);
    const [row] = await db.select().from(team).where(eq(team.id, teamId)).limit(1);
    if (row) syncSeats(row);
  }
}

export interface HarkNotice {
  title: string;
  body: string;
  sourceName: string;
  url?: string;
  appId?: string;
  /** Groups the pushes into one conversation on the phone. */
  conversationKey: string;
}

/**
 * Sends Hark's own notice (an invite, a shared app) to users: one inbox row
 * each, pushed to their active iPhones in the regular webhook shape so a tap
 * opens `url` or the app. Not counted against anyone's allowance.
 */
export async function sendNotice(userIds: string[], notice: HarkNotice): Promise<number> {
  if (userIds.length === 0) return 0;
  // Titles and bodies carry user-chosen names; keep them free of invisible or
  // reordering characters that could disguise a Hark notice.
  notice = {
    ...notice,
    title: sanitizeDisplayText(notice.title),
    body: sanitizeDisplayText(notice.body),
  };
  const now = new Date();
  let accepted = 0;
  for (const userId of userIds) {
    const id = newId("anot");
    await db.insert(agentNotification).values({
      id,
      userId,
      requesterTokenId: null,
      sourceName: notice.sourceName,
      title: notice.title,
      body: notice.body,
      url: notice.url ?? null,
      appId: notice.appId ?? null,
      createdAt: now,
    });
    const devices = await db
      .select({ token: device.expoPushToken })
      .from(device)
      .where(and(eq(device.userId, userId), eq(device.active, true), eq(device.platform, "ios")));
    if (devices.length === 0) continue;
    const result = await sendPushMessages(
      buildPushMessages({
        to: devices.map((row) => row.token),
        eventId: id,
        serviceId: "hark-teams",
        conversationKey: notice.conversationKey,
        ...(notice.appId ? { appId: notice.appId } : {}),
        resolved: {
          title: notice.title,
          body: notice.body,
          ...(notice.url ? { url: notice.url } : {}),
        },
      }),
    );
    if (result.staleTokens.length > 0) {
      await db
        .update(device)
        .set({ active: false })
        .where(inArray(device.expoPushToken, result.staleTokens));
    }
    await db
      .update(agentNotification)
      .set({ acceptedCount: result.accepted })
      .where(eq(agentNotification.id, id));
    accepted += result.accepted;
  }
  return accepted;
}

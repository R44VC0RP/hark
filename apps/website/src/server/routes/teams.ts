import {
  API_ERROR_CODE_SEAT_LIMIT,
  type BillingRedirectResponse,
  MAX_MEMBERS_PER_TEAM,
  MAX_ONCALL_GROUPS_PER_TEAM,
  MAX_PENDING_INVITES_PER_TEAM,
  MAX_TEAMS_PER_ACCOUNT,
  oncallGroupCreateSchema,
  sanitizeDisplayText,
  TEAM_INVITE_TTL_SECONDS,
  type TeamInviteCreateResponse,
  type TeamInvitePreviewDto,
  type TeamJoinResponse,
  type TeamRole,
  teamCreateSchema,
  teamInviteCreateSchema,
  teamMemberUpdateSchema,
  teamUpdateSchema,
  USER_NAME_MAX_CHARS,
} from "@hark/contracts";
import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { db } from "../db";
import { app, oncallGroup, team, teamInvite, teamMember, user as userTable } from "../db/schema";
import { env } from "../env";
import { selectAppsWithJoins, toAppDto } from "../lib/apps";
import { newId } from "../lib/id";
import { checkRotation, listTeamPages, toGroupDto } from "../lib/oncall";
import {
  createTeamBillingPortal,
  createTeamCheckout,
  teamBillingConfigured,
  teamCanSeat,
} from "../lib/team-billing";
import {
  billingCustomer,
  deleteTeam,
  hasRole,
  listMembers,
  listTeams,
  memberCount,
  memberDto,
  membership,
  removeMember,
  revokeInvitesBy,
  sendNotice,
  syncSeats,
  toInviteDto,
  toTeamDto,
} from "../lib/teams";
import { generateTeamInviteCode, hashTeamInviteCode } from "../lib/token";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";
import { requestKey } from "./device-authorization";

/** The person acting: a signed-in user, or the owner of an agent token. */
export interface Actor {
  id: string;
  name: string;
  email: string;
}

/** A route outcome shared by the session and agent-token twins. */
export interface Outcome {
  status: ContentfulStatusCode;
  body: unknown;
}

const result = (body: unknown, status: ContentfulStatusCode = 200): Outcome => ({ status, body });
const failure = (status: ContentfulStatusCode, error: string, extra: object = {}): Outcome => ({
  status,
  body: { error, ...extra },
});

export function send(c: Context, outcome: Outcome) {
  return c.json(outcome.body as object, outcome.status);
}

export const TEAM_NOT_FOUND = failure(404, "Team not found");
const FORBIDDEN_ADMIN = failure(403, "Only team owners and admins can do this");
const SEAT_LIMIT = failure(
  402,
  "This team has used its free seat. Upgrade to the team plan to add members.",
  { code: API_ERROR_CODE_SEAT_LIMIT },
);

export async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

/** Loads the owner of the calling agent token as the actor. */
export async function agentActor(c: Context<AgentEnv>): Promise<Actor | undefined> {
  const [owner] = await db
    .select({ id: userTable.id, name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, c.get("apiToken").userId))
    .limit(1);
  return owner;
}

function inviteUrl(code: string): string {
  return `${new URL(env.APP_URL).origin}/join/${code}`;
}

async function teamCountFor(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(teamMember)
    .where(eq(teamMember.userId, userId));
  return row?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function createTeam(actor: Actor, input: unknown): Promise<Outcome> {
  const parsed = teamCreateSchema.safeParse(input);
  if (!parsed.success) return failure(400, "Invalid team", { issues: parsed.error.issues });
  if ((await teamCountFor(actor.id)) >= MAX_TEAMS_PER_ACCOUNT) {
    return failure(409, `Team limit reached (${MAX_TEAMS_PER_ACCOUNT} per account)`);
  }
  const now = new Date();
  const id = newId("team");
  db.transaction((tx) => {
    tx.insert(team).values({ id, name: parsed.data.name, createdAt: now, updatedAt: now }).run();
    tx.insert(teamMember)
      .values({ teamId: id, userId: actor.id, role: "owner", joinedAt: now })
      .run();
  });
  const created = await membership(id, actor.id);
  if (!created) return TEAM_NOT_FOUND;
  return result({ team: await toTeamDto(created.team, "owner") }, 201);
}

async function getTeam(actor: Actor, teamId: string): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  return result({
    team: await toTeamDto(current.team, current.role),
    members: await listMembers(teamId),
  });
}

async function renameTeam(actor: Actor, teamId: string, input: unknown): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  if (!hasRole(current.role, "admin")) return FORBIDDEN_ADMIN;
  const parsed = teamUpdateSchema.safeParse(input);
  if (!parsed.success) return failure(400, "Invalid team", { issues: parsed.error.issues });
  const [updated] = await db
    .update(team)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(team.id, teamId))
    .returning();
  if (!updated) return TEAM_NOT_FOUND;
  return result({ team: await toTeamDto(updated, current.role) });
}

async function removeTeam(actor: Actor, teamId: string): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  if (current.role !== "owner") return failure(403, "Only the team owner can delete the team");
  deleteTeam(teamId);
  return result({ ok: true });
}

async function leaveTeam(actor: Actor, teamId: string): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  if (current.role === "owner") {
    return failure(409, "Transfer ownership before leaving, or delete the team");
  }
  removeMember(teamId, actor.id);
  syncSeats(current.team);
  return result({ ok: true });
}

async function updateMember(
  actor: Actor,
  teamId: string,
  userId: string,
  input: unknown,
): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  if (!hasRole(current.role, "admin")) return FORBIDDEN_ADMIN;
  const parsed = teamMemberUpdateSchema.safeParse(input);
  if (!parsed.success) return failure(400, "Invalid role", { issues: parsed.error.issues });
  const target = await membership(teamId, userId);
  if (!target) return failure(404, "Member not found");
  const role = parsed.data.role;

  if (role === "owner") {
    if (current.role !== "owner") return failure(403, "Only the owner can transfer ownership");
    if (userId !== actor.id) {
      db.transaction((tx) => {
        tx.update(teamMember)
          .set({ role: "admin" })
          .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, actor.id)))
          .run();
        tx.update(teamMember)
          .set({ role: "owner" })
          .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
          .run();
      });
    }
  } else {
    if (target.role === "owner") {
      return failure(409, "Transfer ownership to someone else before changing the owner's role");
    }
    await db
      .update(teamMember)
      .set({ role })
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
    // A demoted admin can no longer invite, so their outstanding codes stop working.
    if (role === "member") revokeInvitesBy(db, teamId, userId);
  }
  return result({ member: await memberDto(teamId, userId) });
}

async function deleteMember(actor: Actor, teamId: string, userId: string): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  if (userId !== actor.id && !hasRole(current.role, "admin")) return FORBIDDEN_ADMIN;
  const target = await membership(teamId, userId);
  if (!target) return failure(404, "Member not found");
  if (target.role === "owner") return failure(409, "The team owner cannot be removed");
  removeMember(teamId, userId);
  syncSeats(current.team);
  return result({ ok: true });
}

async function listInvites(actor: Actor, teamId: string): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  if (!hasRole(current.role, "admin")) return FORBIDDEN_ADMIN;
  const rows = await db
    .select()
    .from(teamInvite)
    .where(eq(teamInvite.teamId, teamId))
    .orderBy(desc(teamInvite.createdAt))
    .limit(100);
  return result({ invites: rows.map(toInviteDto) });
}

async function createInvite(actor: Actor, teamId: string, input: unknown): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  if (!hasRole(current.role, "admin")) return FORBIDDEN_ADMIN;
  const parsed = teamInviteCreateSchema.safeParse(input ?? {});
  if (!parsed.success) return failure(400, "Invalid invite", { issues: parsed.error.issues });
  if (actorLimited(`invite:${actor.id}`, INVITES_PER_HOUR)) {
    return failure(429, `Invite limit reached (${INVITES_PER_HOUR} per hour)`);
  }
  const members = await memberCount(teamId);
  if (members >= MAX_MEMBERS_PER_TEAM) {
    return failure(409, `Member limit reached (${MAX_MEMBERS_PER_TEAM} per team)`);
  }
  if (!(await teamCanSeat(await billingCustomer(current.team), members + 1))) return SEAT_LIMIT;

  const code = generateTeamInviteCode();
  const now = new Date();
  const email = parsed.data.email?.toLowerCase() ?? null;
  const values = {
    codeHash: hashTeamInviteCode(code),
    role: parsed.data.role,
    invitedByUserId: actor.id,
    invitedByName:
      sanitizeDisplayText(actor.name).slice(0, USER_NAME_MAX_CHARS).trim() || "A teammate",
    expiresAt: new Date(now.getTime() + TEAM_INVITE_TTL_SECONDS * 1000),
  };
  // Synchronous, so concurrent requests cannot both miss an open invite or the cap.
  const created = db.transaction((tx) => {
    const open = and(
      eq(teamInvite.teamId, teamId),
      isNull(teamInvite.acceptedAt),
      isNull(teamInvite.revokedAt),
      gt(teamInvite.expiresAt, now),
    );
    if (email) {
      // One open invite per address: re-inviting refreshes it under a new code
      // instead of piling up invites (and notices) for the same person.
      const existing = tx
        .select({ id: teamInvite.id })
        .from(teamInvite)
        .where(and(open, eq(teamInvite.email, email)))
        .orderBy(desc(teamInvite.createdAt))
        .limit(1)
        .get();
      if (existing) {
        const row = tx
          .update(teamInvite)
          .set(values)
          .where(eq(teamInvite.id, existing.id))
          .returning()
          .get();
        return { row, reused: true };
      }
    }
    const pending = tx.select({ value: count() }).from(teamInvite).where(open).get();
    if ((pending?.value ?? 0) >= MAX_PENDING_INVITES_PER_TEAM) return null;
    const row = tx
      .insert(teamInvite)
      .values({ id: newId("tinv"), teamId, email, ...values, createdAt: now })
      .returning()
      .get();
    return { row, reused: false };
  });
  if (!created) {
    return failure(
      409,
      `Pending invite limit reached (${MAX_PENDING_INVITES_PER_TEAM} per team). Revoke unused invites first.`,
    );
  }
  const { row, reused } = created;
  if (!row) return failure(500, "Could not create invite");

  if (row.email && !reused) {
    const [invitee] = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(sql`lower(${userTable.email}) = ${row.email}`)
      .limit(1);
    if (
      invitee &&
      !(await membership(teamId, invitee.id)) &&
      !actorLimited(`notice:${actor.id}`, INVITE_NOTICES_PER_HOUR)
    ) {
      void sendNotice([invitee.id], {
        title: `${row.invitedByName} invited you to ${current.team.name}`,
        body: `Tap to join ${current.team.name} on Hark.`,
        sourceName: "Hark Teams",
        url: `hark://join/${code}`,
        conversationKey: `team-${teamId}`,
      }).catch((error: unknown) => console.error("[teams] Invite notice failed", error));
    }
  }
  const body: TeamInviteCreateResponse = { invite: toInviteDto(row), code, url: inviteUrl(code) };
  return result(body, reused ? 200 : 201);
}

async function revokeInvite(actor: Actor, teamId: string, inviteId: string): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  if (!hasRole(current.role, "admin")) return FORBIDDEN_ADMIN;
  const [row] = await db
    .select()
    .from(teamInvite)
    .where(and(eq(teamInvite.id, inviteId), eq(teamInvite.teamId, teamId)))
    .limit(1);
  if (!row) return failure(404, "Invite not found");
  if (!row.revokedAt && !row.acceptedAt) {
    await db.update(teamInvite).set({ revokedAt: new Date() }).where(eq(teamInvite.id, row.id));
  }
  return result({ ok: true });
}

/** An invite that can still be accepted. */
async function openInvite(code: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return undefined;
  const [row] = await db
    .select({ invite: teamInvite, team })
    .from(teamInvite)
    .innerJoin(team, eq(team.id, teamInvite.teamId))
    // The inviter must still be able to invite: a removed or demoted admin's
    // codes (or ones whose inviter deleted their account) no longer work.
    .innerJoin(
      teamMember,
      and(
        eq(teamMember.teamId, teamInvite.teamId),
        eq(teamMember.userId, teamInvite.invitedByUserId),
        inArray(teamMember.role, ["owner", "admin"]),
      ),
    )
    .where(
      and(
        eq(teamInvite.codeHash, hashTeamInviteCode(code)),
        isNull(teamInvite.revokedAt),
        isNull(teamInvite.acceptedAt),
        gt(teamInvite.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row;
}

async function acceptInvite(actor: Actor, code: string): Promise<Outcome> {
  const found = await openInvite(code);
  if (!found) return failure(404, "This invite is invalid, used, or expired");
  // An invite addressed to an email binds to that account, not to whoever
  // holds the code.
  if (found.invite.email && found.invite.email.toLowerCase() !== actor.email.toLowerCase()) {
    return failure(403, "This invite was sent to a different email address");
  }
  const existing = await membership(found.team.id, actor.id);
  if (existing) {
    const body: TeamJoinResponse = {
      team: await toTeamDto(existing.team, existing.role),
      joined: false,
    };
    return result(body);
  }
  if ((await teamCountFor(actor.id)) >= MAX_TEAMS_PER_ACCOUNT) {
    return failure(409, `Team limit reached (${MAX_TEAMS_PER_ACCOUNT} per account)`);
  }
  const members = await memberCount(found.team.id);
  if (members >= MAX_MEMBERS_PER_TEAM) {
    return failure(409, `This team is full (${MAX_MEMBERS_PER_TEAM} members)`);
  }
  const customer = await billingCustomer(found.team);
  if (!(await teamCanSeat(customer, members + 1))) return SEAT_LIMIT;

  const now = new Date();
  const joined = db.transaction((tx) => {
    const claimed = tx
      .update(teamInvite)
      .set({ acceptedAt: now, acceptedByUserId: actor.id })
      .where(
        and(
          eq(teamInvite.id, found.invite.id),
          isNull(teamInvite.acceptedAt),
          isNull(teamInvite.revokedAt),
        ),
      )
      .returning({ id: teamInvite.id })
      .all();
    if (claimed.length === 0) return false;
    tx.insert(teamMember)
      .values({ teamId: found.team.id, userId: actor.id, role: found.invite.role, joinedAt: now })
      .onConflictDoNothing()
      .run();
    return true;
  });
  if (!joined) return failure(404, "This invite is invalid, used, or expired");
  syncSeats(found.team);
  const body: TeamJoinResponse = {
    team: await toTeamDto(found.team, found.invite.role as TeamRole),
    joined: true,
  };
  return result(body);
}

async function listTeamApps(actor: Actor, teamId: string): Promise<Outcome> {
  if (!(await membership(teamId, actor.id))) return TEAM_NOT_FOUND;
  const rows = await selectAppsWithJoins(actor.id)
    .where(eq(app.teamId, teamId))
    .orderBy(asc(app.name), asc(app.id));
  return result({ apps: rows.map((row) => toAppDto(row, actor.id)) });
}

async function listGroups(actor: Actor, teamId: string): Promise<Outcome> {
  if (!(await membership(teamId, actor.id))) return TEAM_NOT_FOUND;
  const groups = await db
    .select()
    .from(oncallGroup)
    .where(eq(oncallGroup.teamId, teamId))
    .orderBy(asc(oncallGroup.name), asc(oncallGroup.id));
  const now = Date.now();
  return result({ groups: await Promise.all(groups.map((group) => toGroupDto(group, now))) });
}

async function createGroup(actor: Actor, teamId: string, input: unknown): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  if (!hasRole(current.role, "admin")) return FORBIDDEN_ADMIN;
  const parsed = oncallGroupCreateSchema.safeParse(input);
  if (!parsed.success)
    return failure(400, "Invalid on-call group", { issues: parsed.error.issues });
  const [existing] = await db
    .select({ value: count() })
    .from(oncallGroup)
    .where(eq(oncallGroup.teamId, teamId));
  if ((existing?.value ?? 0) >= MAX_ONCALL_GROUPS_PER_TEAM) {
    return failure(409, `On-call group limit reached (${MAX_ONCALL_GROUPS_PER_TEAM} per team)`);
  }
  const rotation = await checkRotation(teamId, parsed.data.rotation);
  if (!rotation.ok) return failure(400, rotation.error);
  const now = new Date();
  const [group] = await db
    .insert(oncallGroup)
    .values({
      id: newId("ocg"),
      teamId,
      name: parsed.data.name,
      ...rotation.values,
      escalation: parsed.data.escalation,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!group) return failure(500, "Could not create group");
  return result({ group: await toGroupDto(group) }, 201);
}

async function teamPages(
  actor: Actor,
  teamId: string,
  query: (name: string) => string | undefined,
): Promise<Outcome> {
  if (!(await membership(teamId, actor.id))) return TEAM_NOT_FOUND;
  const listed = await listTeamPages(teamId, {
    status: query("status"),
    cursor: query("cursor"),
    limit: query("limit"),
  });
  return listed.ok ? result(listed.body) : failure(400, listed.error);
}

async function billingRedirect(
  actor: Actor,
  teamId: string,
  kind: "checkout" | "portal",
): Promise<Outcome> {
  const current = await membership(teamId, actor.id);
  if (!current) return TEAM_NOT_FOUND;
  // The portal can cancel the plan and shows the owner's payment details.
  if (current.role !== "owner") return failure(403, "Only the team owner can manage billing");
  if (!teamBillingConfigured()) return failure(503, "Billing is not configured");
  const customer = await billingCustomer(current.team);
  try {
    const url =
      kind === "checkout"
        ? await createTeamCheckout(customer, await memberCount(teamId))
        : await createTeamBillingPortal(customer);
    return result({ url } satisfies BillingRedirectResponse);
  } catch (error) {
    console.error(`[team-billing] Could not open ${kind}`, error);
    return failure(
      502,
      kind === "checkout" ? "Could not start checkout" : "Could not open billing portal",
    );
  }
}

// ---------------------------------------------------------------------------
// Per-actor invite limits
// ---------------------------------------------------------------------------

const INVITES_PER_HOUR = 20;
/** Invite pushes an actor can cause per hour, so invites cannot be used to spam. */
const INVITE_NOTICES_PER_HOUR = 10;
const actorBuckets = new Map<string, { count: number; resetAt: number }>();

function actorLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const current = actorBuckets.get(key);
  if (!current || current.resetAt <= now) {
    if (actorBuckets.size > 10_000) {
      for (const [candidate, bucket] of actorBuckets) {
        if (bucket.resetAt <= now) actorBuckets.delete(candidate);
      }
    }
    actorBuckets.set(key, { count: 1, resetAt: now + 3_600_000 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

// ---------------------------------------------------------------------------
// Public invite preview (rate limited; no session)
// ---------------------------------------------------------------------------

const previewBuckets = new Map<string, { count: number; resetAt: number }>();

function previewLimited(key: string | null): boolean {
  const now = Date.now();
  const consume = (bucketKey: string, limit: number) => {
    const current = previewBuckets.get(bucketKey);
    if (!current || current.resetAt <= now) {
      if (previewBuckets.size > 10_000) previewBuckets.clear();
      previewBuckets.set(bucketKey, { count: 1, resetAt: now + 60_000 });
      return false;
    }
    current.count += 1;
    return current.count > limit;
  };
  if (key !== null && consume(`client:${key}`, 30)) return true;
  return consume("global", 600);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function sessionActor(c: Context<AuthedEnv>): Actor {
  const user = c.get("user");
  return { id: user.id, name: user.name, email: user.email };
}

export const teamsSessionRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json({ teams: await listTeams(c.get("user").id) }))
  .post("/", async (c) => send(c, await createTeam(sessionActor(c), await readJson(c))))
  .get("/:id", async (c) => send(c, await getTeam(sessionActor(c), c.req.param("id"))))
  .patch("/:id", async (c) =>
    send(c, await renameTeam(sessionActor(c), c.req.param("id"), await readJson(c))),
  )
  .delete("/:id", async (c) => send(c, await removeTeam(sessionActor(c), c.req.param("id"))))
  .post("/:id/leave", async (c) => send(c, await leaveTeam(sessionActor(c), c.req.param("id"))))
  .patch("/:id/members/:userId", async (c) =>
    send(
      c,
      await updateMember(
        sessionActor(c),
        c.req.param("id"),
        c.req.param("userId"),
        await readJson(c),
      ),
    ),
  )
  .delete("/:id/members/:userId", async (c) =>
    send(c, await deleteMember(sessionActor(c), c.req.param("id"), c.req.param("userId"))),
  )
  .get("/:id/invites", async (c) => send(c, await listInvites(sessionActor(c), c.req.param("id"))))
  .post("/:id/invites", async (c) =>
    send(c, await createInvite(sessionActor(c), c.req.param("id"), await readJson(c))),
  )
  .delete("/:id/invites/:inviteId", async (c) =>
    send(c, await revokeInvite(sessionActor(c), c.req.param("id"), c.req.param("inviteId"))),
  )
  .get("/:id/apps", async (c) => send(c, await listTeamApps(sessionActor(c), c.req.param("id"))))
  .post("/:id/billing/checkout", async (c) =>
    send(c, await billingRedirect(sessionActor(c), c.req.param("id"), "checkout")),
  )
  .post("/:id/billing/portal", async (c) =>
    send(c, await billingRedirect(sessionActor(c), c.req.param("id"), "portal")),
  )
  .get("/:id/oncall", async (c) => send(c, await listGroups(sessionActor(c), c.req.param("id"))))
  .post("/:id/oncall", async (c) =>
    send(c, await createGroup(sessionActor(c), c.req.param("id"), await readJson(c))),
  )
  .get("/:id/pages", async (c) =>
    send(c, await teamPages(sessionActor(c), c.req.param("id"), (name) => c.req.query(name))),
  );

/** Invite preview (public) and acceptance (session only: joining is a human decision). */
export const teamInvitesRoute = new Hono<AuthedEnv>()
  .get("/:code", async (c) => {
    if (previewLimited(requestKey(c))) {
      c.header("Retry-After", "60");
      return c.json({ error: "Too many requests" }, 429);
    }
    const found = await openInvite(c.req.param("code"));
    if (!found) return c.json({ error: "This invite is invalid, used, or expired" }, 404);
    c.header("Cache-Control", "no-store");
    return c.json<TeamInvitePreviewDto>({
      teamName: found.team.name,
      invitedBy: found.invite.invitedByName,
      role: found.invite.role as TeamRole,
      memberCount: await memberCount(found.team.id),
      expiresAt: found.invite.expiresAt.toISOString(),
    });
  })
  .post("/:code/accept", requireAuth, async (c) =>
    send(c, await acceptInvite(sessionActor(c), c.req.param("code"))),
  );

/**
 * Agent-token twin of {@link teamsSessionRoute}, mounted at `/api/agent/teams`.
 * Accepting invites and team billing stay session-only.
 */
export const teamsAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/", requireScopes("teams:read"), async (c) =>
    c.json({ teams: await listTeams(c.get("apiToken").userId) }),
  )
  .post("/", requireScopes("teams:write"), async (c) =>
    withAgent(c, (actor) => readJson(c).then((input) => createTeam(actor, input))),
  )
  .get("/:id", requireScopes("teams:read"), async (c) =>
    withAgent(c, (actor) => getTeam(actor, c.req.param("id"))),
  )
  .patch("/:id", requireScopes("teams:write"), async (c) =>
    withAgent(c, async (actor) => renameTeam(actor, c.req.param("id"), await readJson(c))),
  )
  .delete("/:id", requireScopes("teams:write"), async (c) =>
    withAgent(c, (actor) => removeTeam(actor, c.req.param("id"))),
  )
  .post("/:id/leave", requireScopes("teams:write"), async (c) =>
    withAgent(c, (actor) => leaveTeam(actor, c.req.param("id"))),
  )
  .patch("/:id/members/:userId", requireScopes("teams:write"), async (c) =>
    withAgent(c, async (actor) =>
      updateMember(actor, c.req.param("id"), c.req.param("userId"), await readJson(c)),
    ),
  )
  .delete("/:id/members/:userId", requireScopes("teams:write"), async (c) =>
    withAgent(c, (actor) => deleteMember(actor, c.req.param("id"), c.req.param("userId"))),
  )
  .get("/:id/invites", requireScopes("teams:read"), async (c) =>
    withAgent(c, (actor) => listInvites(actor, c.req.param("id"))),
  )
  .post("/:id/invites", requireScopes("teams:write"), async (c) =>
    withAgent(c, async (actor) => createInvite(actor, c.req.param("id"), await readJson(c))),
  )
  .delete("/:id/invites/:inviteId", requireScopes("teams:write"), async (c) =>
    withAgent(c, (actor) => revokeInvite(actor, c.req.param("id"), c.req.param("inviteId"))),
  )
  .get("/:id/apps", requireScopes("teams:read", "apps:read"), async (c) =>
    withAgent(c, (actor) => listTeamApps(actor, c.req.param("id"))),
  )
  .get("/:id/oncall", requireScopes("oncall:read"), async (c) =>
    withAgent(c, (actor) => listGroups(actor, c.req.param("id"))),
  )
  .post("/:id/oncall", requireScopes("oncall:write"), async (c) =>
    withAgent(c, async (actor) => createGroup(actor, c.req.param("id"), await readJson(c))),
  )
  .get("/:id/pages", requireScopes("oncall:read"), async (c) =>
    withAgent(c, (actor) => teamPages(actor, c.req.param("id"), (name) => c.req.query(name))),
  );

export async function withAgent(c: Context<AgentEnv>, run: (actor: Actor) => Promise<Outcome>) {
  const actor = await agentActor(c);
  if (!actor) return c.json({ error: "Account not found" }, 404);
  return send(c, await run(actor));
}

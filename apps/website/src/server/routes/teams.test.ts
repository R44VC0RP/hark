import type {
  AppDto,
  AppPassClaims,
  AppPassResponse,
  InboxNotificationPageDto,
  TeamDto,
  TeamInviteCreateResponse,
  TeamInvitePreviewDto,
  TeamJoinResponse,
  TeamMemberDto,
} from "@hark/contracts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "user_a" as string | null }));
const seatState = vi.hoisted(() => ({ paid: true }));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);

const NAMES: Record<string, string> = {
  user_a: "Ryan",
  user_b: "Bea",
  user_c: "Cam",
  user_d: "Dee",
  user_e: "Eli",
  user_f: "Fay",
};

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: NAMES[authState.userId] ?? authState.userId,
                email: `${authState.userId}@example.com`,
                image: null,
              },
            }
          : null,
    },
  },
}));

// Seats are unlimited without Autumn; this mock stands in for a configured
// Autumn account so the free-seat limit can be exercised.
vi.mock("../lib/team-billing", () => ({
  teamBillingConfigured: () => true,
  teamSeats: async (_team: unknown, used: number) =>
    seatState.paid
      ? { plan: "team", seats: { used, available: null, billable: Math.max(0, used - 1) } }
      : { plan: "free", seats: { used, available: 1, billable: 0 } },
  teamCanSeat: async (_team: unknown, next: number) => seatState.paid || next <= 1,
  syncTeamSeats: async () => undefined,
  createTeamCheckout: async (team: { id: string }) => `https://billing.example.com/${team.id}`,
  createTeamBillingPortal: async () => "https://billing.example.com/portal",
}));

vi.mock("expo-server-sdk", () => {
  class Expo {
    chunkPushNotifications(messages: Array<Record<string, unknown>>) {
      return [messages];
    }
    async sendPushNotificationsAsync(messages: Array<Record<string, unknown>>) {
      sent.push(...messages);
      return messages.map(() => ({ status: "ok", id: "ticket" }));
    }
  }
  return { Expo, default: Expo };
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");

const TEAMS_TOKEN = `hark_${"t".repeat(43)}`;
const NO_TEAMS_TOKEN = `hark_${"u".repeat(43)}`;

function as(userId: string | null) {
  authState.userId = userId;
}

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return app.request(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Lets fire-and-forget notices finish before asserting on pushes. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function claimsOf(token: string): AppPassClaims {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as AppPassClaims;
}

afterEach(() => {
  sent.length = 0;
  seatState.paid = true;
  as("user_a");
});

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  const { hashApiToken } = await import("../lib/token");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values(
    Object.entries(NAMES).map(([id, name]) => ({
      id,
      name,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db.insert(schema.device).values(
    Object.keys(NAMES).map((id) => ({
      id: `dev_${id}`,
      userId: id,
      expoPushToken: `ExponentPushToken[${id}]`,
      createdAt: now,
      lastSeenAt: now,
    })),
  );
  await db.insert(schema.apiToken).values([
    {
      id: "tok_teams",
      userId: "user_a",
      name: "Team bot",
      tokenHash: hashApiToken(TEAMS_TOKEN),
      prefix: "hark_ttttttt",
      scopes: ["teams:read", "teams:write", "apps:read", "apps:write"],
      createdAt: now,
    },
    {
      id: "tok_noteams",
      userId: "user_a",
      name: "Narrow bot",
      tokenHash: hashApiToken(NO_TEAMS_TOKEN),
      prefix: "hark_uuuuuuu",
      scopes: ["apps:read"],
      createdAt: now,
    },
  ]);
});

async function createTeam(name: string): Promise<TeamDto> {
  const response = await call("POST", "/api/teams", { name });
  expect(response.status).toBe(201);
  return ((await response.json()) as { team: TeamDto }).team;
}

async function invite(teamId: string, body: unknown = {}): Promise<TeamInviteCreateResponse> {
  const response = await call("POST", `/api/teams/${teamId}/invites`, body);
  expect(response.status).toBe(201);
  return (await response.json()) as TeamInviteCreateResponse;
}

async function join(userId: string, code: string): Promise<TeamJoinResponse> {
  as(userId);
  const response = await call("POST", `/api/team-invites/${code}/accept`);
  expect(response.status).toBe(200);
  return (await response.json()) as TeamJoinResponse;
}

describe("teams and invites", () => {
  it("creates a team owned by its creator and lets an invitee join through the link", async () => {
    const team = await createTeam("Acme");
    expect(team).toMatchObject({ name: "Acme", role: "owner", memberCount: 1, plan: "team" });
    expect(team.id).toMatch(/^team_/);

    const created = await invite(team.id);
    expect(created.url).toBe(`http://localhost:5173/join/${created.code}`);
    expect(created.invite).toMatchObject({ role: "member", invitedBy: "Ryan", acceptedAt: null });

    as(null);
    const preview = await call("GET", `/api/team-invites/${created.code}`);
    expect(preview.status).toBe(200);
    expect((await preview.json()) as TeamInvitePreviewDto).toMatchObject({
      teamName: "Acme",
      invitedBy: "Ryan",
      role: "member",
      memberCount: 1,
    });
    // Accepting is a human decision: no session, no join.
    expect((await call("POST", `/api/team-invites/${created.code}/accept`)).status).toBe(401);

    const joined = await join("user_b", created.code);
    expect(joined.joined).toBe(true);
    expect(joined.team).toMatchObject({ id: team.id, role: "member", memberCount: 2 });

    // Single use: the code is spent.
    as(null);
    expect((await call("GET", `/api/team-invites/${created.code}`)).status).toBe(404);
    as("user_b");
    const listed = (await (await call("GET", "/api/teams")).json()) as { teams: TeamDto[] };
    expect(listed.teams.map((entry) => [entry.name, entry.role])).toEqual([["Acme", "member"]]);
  });

  it("requires the paid team plan for a second seat", async () => {
    seatState.paid = false;
    const team = await createTeam("Solo");
    expect(team).toMatchObject({ plan: "free", seats: { used: 1, available: 1, billable: 0 } });
    const response = await call("POST", `/api/teams/${team.id}/invites`, {});
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "seat_limit" });

    // An invite created while paid still cannot be redeemed after downgrading.
    seatState.paid = true;
    const created = await invite(team.id);
    seatState.paid = false;
    as("user_b");
    const accept = await call("POST", `/api/team-invites/${created.code}/accept`);
    expect(accept.status).toBe(402);
    expect(await accept.json()).toMatchObject({ code: "seat_limit" });

    as("user_a");
    const checkout = await call("POST", `/api/teams/${team.id}/billing/checkout`);
    expect(await checkout.json()).toEqual({ url: `https://billing.example.com/${team.id}` });
  });

  it("pushes an invite to an existing user with that email and files it in their inbox", async () => {
    const team = await createTeam("Pushed");
    const created = await invite(team.id, { email: "USER_C@example.com" });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[user_c]",
      title: "Ryan invited you to Pushed",
      data: { url: `hark://join/${created.code}` },
    });
    as("user_c");
    const inbox = (await (
      await call("GET", "/api/inbox/notifications")
    ).json()) as InboxNotificationPageDto;
    expect(inbox.items[0]).toMatchObject({
      title: "Ryan invited you to Pushed",
      sourceName: "Hark Teams",
      url: `hark://join/${created.code}`,
    });
  });

  it("enforces roles and transfers ownership", async () => {
    const team = await createTeam("Roles");
    await join("user_b", (await invite(team.id)).code);

    as("user_b");
    expect((await call("PATCH", `/api/teams/${team.id}`, { name: "Mine" })).status).toBe(403);
    expect((await call("POST", `/api/teams/${team.id}/invites`, {})).status).toBe(403);
    expect((await call("DELETE", `/api/teams/${team.id}`)).status).toBe(403);

    as("user_a");
    expect((await call("POST", `/api/teams/${team.id}/leave`)).status).toBe(409);
    const promoted = await call("PATCH", `/api/teams/${team.id}/members/user_b`, { role: "admin" });
    expect(((await promoted.json()) as { member: TeamMemberDto }).member.role).toBe("admin");

    as("user_b");
    // Admins cannot hand out ownership or remove the owner.
    expect(
      (await call("PATCH", `/api/teams/${team.id}/members/user_b`, { role: "owner" })).status,
    ).toBe(403);
    expect((await call("DELETE", `/api/teams/${team.id}/members/user_a`)).status).toBe(409);
    const renamed = await call("PATCH", `/api/teams/${team.id}`, { name: "Roles 2" });
    expect(((await renamed.json()) as { team: TeamDto }).team.name).toBe("Roles 2");

    as("user_a");
    const transfer = await call("PATCH", `/api/teams/${team.id}/members/user_b`, { role: "owner" });
    expect(transfer.status).toBe(200);
    const detail = (await (await call("GET", `/api/teams/${team.id}`)).json()) as {
      team: TeamDto;
      members: TeamMemberDto[];
    };
    expect(detail.team.role).toBe("admin");
    expect(detail.members.map((member) => [member.userId, member.role])).toEqual([
      ["user_b", "owner"],
      ["user_a", "admin"],
    ]);
    expect((await call("POST", `/api/teams/${team.id}/leave`)).status).toBe(200);
    expect((await call("GET", `/api/teams/${team.id}`)).status).toBe(404);
  });

  it("revokes invites", async () => {
    const team = await createTeam("Revoke");
    const created = await invite(team.id);
    expect(
      (await call("DELETE", `/api/teams/${team.id}/invites/${created.invite.id}`)).status,
    ).toBe(200);
    const list = (await (await call("GET", `/api/teams/${team.id}/invites`)).json()) as {
      invites: Array<{ revokedAt: string | null }>;
    };
    expect(list.invites[0]?.revokedAt).not.toBeNull();
    as("user_b");
    expect((await call("POST", `/api/team-invites/${created.code}/accept`)).status).toBe(404);
  });
});

describe("invite abuse and membership changes", () => {
  it("keeps one open invite and one notice per invitee, and caps invites per hour", async () => {
    as("user_d");
    const team = await createTeam("URGENT:\u202e Hark\u200b alert");
    expect(team.name).toBe("URGENT: Hark alert");
    const statuses: number[] = [];
    const bodies: TeamInviteCreateResponse[] = [];
    for (let index = 0; index < 30; index += 1) {
      const response = await call("POST", `/api/teams/${team.id}/invites`, {
        email: "user_c@example.com",
      });
      statuses.push(response.status);
      if (response.status < 300) bodies.push((await response.json()) as TeamInviteCreateResponse);
    }
    await settle();
    expect(statuses[0]).toBe(201);
    expect(statuses.slice(1, 20).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(20).every((status) => status === 429)).toBe(true);
    expect(new Set(bodies.map((body) => body.invite.id)).size).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: "Dee invited you to URGENT: Hark alert" });
    // Only the latest code works.
    as(null);
    expect((await call("GET", `/api/team-invites/${bodies[0]?.code}`)).status).toBe(404);
    expect((await call("GET", `/api/team-invites/${bodies.at(-1)?.code}`)).status).toBe(200);
  });

  it("stops a removed or demoted admin's invites and keeps billing owner-only", async () => {
    as("user_e");
    const team = await createTeam("Inviters");
    await join("user_f", (await invite(team.id, { role: "admin" })).code);
    as("user_f");
    const removedCode = (await invite(team.id, { role: "admin" })).code;
    expect((await call("POST", `/api/teams/${team.id}/billing/portal`)).status).toBe(403);
    expect((await call("POST", `/api/teams/${team.id}/billing/checkout`)).status).toBe(403);
    as("user_e");
    expect((await call("DELETE", `/api/teams/${team.id}/members/user_f`)).status).toBe(200);
    as("user_b");
    expect((await call("POST", `/api/team-invites/${removedCode}/accept`)).status).toBe(404);

    as("user_e");
    await join("user_f", (await invite(team.id, { role: "admin" })).code);
    as("user_f");
    const demotedCode = (await invite(team.id)).code;
    as("user_e");
    await call("PATCH", `/api/teams/${team.id}/members/user_f`, { role: "member" });
    as("user_b");
    expect((await call("POST", `/api/team-invites/${demotedCode}/accept`)).status).toBe(404);
  });

  it("hands a deleted owner's teams to the longest-serving admin and deletes solo teams", async () => {
    const { releaseTeamsOf } = await import("../lib/teams");
    as("user_b");
    const shared = await createTeam("Handover");
    await join("user_c", (await invite(shared.id)).code);
    as("user_b");
    await join("user_e", (await invite(shared.id, { role: "admin" })).code);
    as("user_b");
    const solo = await createTeam("Alone");

    await releaseTeamsOf("user_b");
    as("user_e");
    const detail = (await (await call("GET", `/api/teams/${shared.id}`)).json()) as {
      members: TeamMemberDto[];
    };
    expect(detail.members.map((member) => [member.userId, member.role])).toEqual([
      ["user_e", "owner"],
      ["user_c", "member"],
    ]);
    const [left] = await db
      .select()
      .from(schema.team)
      .where((await import("drizzle-orm")).eq(schema.team.id, solo.id));
    expect(left).toBeUndefined();
  });
});

describe("team apps", () => {
  it("shares an app, lets every member approve sign-in, and blocks removed members", async () => {
    const team = await createTeam("Apps");
    await join("user_b", (await invite(team.id)).code);
    as("user_a");
    const now = new Date();
    await db.insert(schema.app).values({
      id: "app_shared_0001",
      userId: "user_a",
      name: "Ops",
      url: "https://ops.example.com/",
      origin: "https://ops.example.com",
      consentedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    sent.length = 0;

    as("user_b");
    expect(
      (await call("POST", "/api/apps/app_shared_0001/share", { teamId: team.id })).status,
    ).toBe(404);

    as("user_a");
    const shared = await call("POST", "/api/apps/app_shared_0001/share", { teamId: team.id });
    expect(shared.status).toBe(200);
    const sharedApp = ((await shared.json()) as { app: AppDto }).app;
    expect(sharedApp.team).toEqual({ id: team.id, name: "Apps" });
    // The adder keeps their earlier approval.
    expect(sharedApp.consentedAt).not.toBeNull();
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[user_b]",
      title: "Ryan added Ops to Apps",
      data: { appId: "app_shared_0001" },
    });

    as("user_b");
    const apps = ((await (await call("GET", "/api/apps")).json()) as { apps: AppDto[] }).apps;
    expect(apps.map((entry) => [entry.id, entry.addedBy, entry.consentedAt])).toEqual([
      ["app_shared_0001", "Ryan", null],
    ]);
    const blocked = await call("POST", "/api/apps/app_shared_0001/pass", {});
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "consent_required" });
    const pass = await call("POST", "/api/apps/app_shared_0001/pass", {
      consent: true,
      shareEmail: true,
    });
    expect(pass.status).toBe(200);
    const body = (await pass.json()) as AppPassResponse;
    expect(claimsOf(body.token)).toMatchObject({
      app_id: "app_shared_0001",
      team_id: team.id,
      team_role: "member",
      email: "user_b@example.com",
      name: "Bea",
    });
    // Members cannot remove an app someone else added.
    expect((await call("DELETE", "/api/apps/app_shared_0001")).status).toBe(403);

    as("user_a");
    const ownerPass = (await (
      await call("POST", "/api/apps/app_shared_0001/pass", {})
    ).json()) as AppPassResponse;
    expect(claimsOf(ownerPass.token)).toMatchObject({ team_role: "owner" });
    expect(claimsOf(ownerPass.token).email).toBeUndefined();

    expect((await call("DELETE", `/api/teams/${team.id}/members/user_b`)).status).toBe(200);
    as("user_b");
    expect((await call("POST", "/api/apps/app_shared_0001/pass", {})).status).toBe(404);
    expect(((await (await call("GET", "/api/apps")).json()) as { apps: AppDto[] }).apps).toEqual(
      [],
    );

    // Deleting the team returns the app to the person who added it.
    as("user_a");
    expect((await call("DELETE", `/api/teams/${team.id}`)).status).toBe(200);
    const returned = (
      (await (await call("GET", "/api/apps/app_shared_0001")).json()) as { app: AppDto }
    ).app;
    expect(returned.team).toBeNull();
    expect(returned.consentedAt).not.toBeNull();
  });

  it("lets agents create team apps and list teams, scope-checked", async () => {
    const team = await createTeam("Agents");
    const listed = await call("GET", "/api/agent/teams", undefined, TEAMS_TOKEN);
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { teams: TeamDto[] }).teams.some((entry) => entry.id === team.id),
    ).toBe(true);
    expect((await call("GET", "/api/agent/teams", undefined, NO_TEAMS_TOKEN)).status).toBe(403);

    const created = await call(
      "POST",
      "/api/agent/apps",
      { name: "Grafana", url: "https://grafana.example.com/", teamId: team.id },
      TEAMS_TOKEN,
    );
    expect(created.status).toBe(201);
    const createdApp = ((await created.json()) as { app: AppDto }).app;
    expect(createdApp.team?.id).toBe(team.id);

    const teamApps = await call("GET", `/api/agent/teams/${team.id}/apps`, undefined, TEAMS_TOKEN);
    expect(((await teamApps.json()) as { apps: AppDto[] }).apps.map((entry) => entry.id)).toEqual([
      createdApp.id,
    ]);
    const unshared = await call(
      "POST",
      `/api/agent/apps/${createdApp.id}/share`,
      { teamId: null },
      TEAMS_TOKEN,
    );
    expect(((await unshared.json()) as { app: AppDto }).app.team).toBeNull();

    const agentInvite = await call("POST", `/api/agent/teams/${team.id}/invites`, {}, TEAMS_TOKEN);
    expect(agentInvite.status).toBe(201);
    // There is no agent route that accepts an invite.
    const { code } = (await agentInvite.json()) as TeamInviteCreateResponse;
    expect(
      (await call("POST", `/api/agent/team-invites/${code}/accept`, undefined, TEAMS_TOKEN)).status,
    ).toBe(404);
  });
});

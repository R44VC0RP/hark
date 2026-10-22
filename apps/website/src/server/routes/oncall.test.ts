import type {
  OncallGroupDto,
  OncallPageCreateResponse,
  OncallPageDto,
  OncallShiftDto,
} from "@hark/contracts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "user_a" as string | null }));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const NAMES: Record<string, string> = {
  user_a: "Ana",
  user_b: "Ben",
  user_c: "Cal",
  user_x: "Xan",
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
let oncall: typeof import("../lib/oncall");

const TEAM_ID = "team_oncalltest01";
const WRITER = `hark_${"w".repeat(43)}`;
const READER = `hark_${"r".repeat(43)}`;
const NOTIFIER = `hark_${"n".repeat(43)}`;
const WEBHOOK = "whk_oncall_webhook_token_000000000000";
const OUTSIDER_WEBHOOK = "whk_outsider_webhook_token_00000000000";

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const pushesTo = (userId: string) =>
  sent.filter((message) => message.to === `ExponentPushToken[${userId}]`);
/** The lock-screen credential from the latest page push to `userId`. */
function responseTokenFor(userId: string): string {
  const data = pushesTo(userId).at(-1)?.data as { responseToken?: string } | undefined;
  if (!data?.responseToken) throw new Error(`No page push for ${userId}`);
  return data.responseToken;
}

afterEach(() => {
  sent.length = 0;
  as("user_a");
});

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  oncall = await import("../lib/oncall");
  const { runMigrations } = await import("../db/migrate");
  const { hashApiToken, hashWebhookToken } = await import("../lib/token");
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
  await db
    .insert(schema.team)
    .values({ id: TEAM_ID, name: "Infra", createdAt: now, updatedAt: now });
  await db.insert(schema.teamMember).values([
    { teamId: TEAM_ID, userId: "user_a", role: "owner", joinedAt: now },
    { teamId: TEAM_ID, userId: "user_b", role: "member", joinedAt: now },
    { teamId: TEAM_ID, userId: "user_c", role: "member", joinedAt: now },
  ]);
  await db.insert(schema.apiToken).values([
    {
      id: "tok_writer",
      userId: "user_a",
      name: "Monitor bot",
      tokenHash: hashApiToken(WRITER),
      prefix: "hark_wwwwwww",
      scopes: ["oncall:read", "oncall:write", "notifications:send"],
      createdAt: now,
    },
    {
      id: "tok_notifier",
      userId: "user_a",
      name: "Notify bot",
      tokenHash: hashApiToken(NOTIFIER),
      prefix: "hark_nnnnnnn",
      scopes: ["notifications:send"],
      createdAt: now,
    },
    {
      id: "tok_reader",
      userId: "user_a",
      name: "Reader bot",
      tokenHash: hashApiToken(READER),
      prefix: "hark_rrrrrrr",
      scopes: ["oncall:read"],
      createdAt: now,
    },
  ]);
  await db.insert(schema.service).values([
    {
      id: "svc_monitor",
      userId: "user_a",
      title: "Uptime",
      tokenHash: hashWebhookToken(WEBHOOK),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "svc_outsider",
      userId: "user_x",
      title: "Stranger",
      tokenHash: hashWebhookToken(OUTSIDER_WEBHOOK),
      createdAt: now,
      updatedAt: now,
    },
  ]);
});

async function createGroup(name: string, escalation?: unknown): Promise<OncallGroupDto> {
  as("user_a");
  const response = await call("POST", `/api/teams/${TEAM_ID}/oncall`, {
    name,
    rotation: {
      memberIds: ["user_a", "user_b", "user_c"],
      period: "daily",
      handoffAt: "09:00",
      timezone: "America/New_York",
    },
    ...(escalation ? { escalation } : {}),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { group: OncallGroupDto }).group;
}

async function page(groupId: string, body: unknown): Promise<Response> {
  return call("POST", `/api/oncall/${groupId}/pages`, body);
}

/** Moves a page's next escalation into the past and runs the worker. */
async function runDueEscalation(pageId: string) {
  const { eq } = await import("drizzle-orm");
  await db
    .update(schema.oncallPage)
    .set({ nextEscalationAt: new Date(Date.now() - 1000) })
    .where(eq(schema.oncallPage.id, pageId));
  await oncall.processDueEscalations();
}

describe("on-call groups", () => {
  it("lets admins create groups, puts the first rotation member on call, and supports overrides", async () => {
    as("user_b");
    const forbidden = await call("POST", `/api/teams/${TEAM_ID}/oncall`, {
      name: "Nope",
      rotation: { memberIds: ["user_b"], period: "daily", handoffAt: "09:00", timezone: "UTC" },
    });
    expect(forbidden.status).toBe(403);

    as("user_a");
    const invalid = await call("POST", `/api/teams/${TEAM_ID}/oncall`, {
      name: "Bad",
      rotation: { memberIds: ["user_x"], period: "daily", handoffAt: "09:00", timezone: "UTC" },
    });
    expect(invalid.status).toBe(400);

    const group = await createGroup("Primary");
    expect(group.current?.person.userId).toBe("user_a");
    expect(group.upcoming.map((shift) => shift.person.userId)).toEqual([
      "user_a",
      "user_b",
      "user_c",
      "user_a",
      "user_b",
    ]);
    expect(group.escalation).toEqual([
      { afterMinutes: 5, target: "next" },
      { afterMinutes: 10, target: "group" },
    ]);

    // Members may cover a shift themselves; the override replaces the rotation.
    as("user_c");
    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 3_600_000).toISOString();
    const covered = await call("POST", `/api/oncall/${group.id}/overrides`, {
      userId: "user_c",
      startsAt: start,
      endsAt: end,
    });
    expect(covered.status).toBe(201);
    const coveredGroup = ((await covered.json()) as { group: OncallGroupDto }).group;
    expect(coveredGroup.current).toMatchObject({ person: { userId: "user_c" }, override: true });
    const overrideId = coveredGroup.overrides?.[0]?.id;
    expect(coveredGroup.current?.overrideId).toBe(overrideId);
    expect(
      (
        await call("POST", `/api/oncall/${group.id}/overrides`, {
          userId: "user_b",
          startsAt: start,
          endsAt: end,
        })
      ).status,
    ).toBe(403);

    const me = (await (await call("GET", "/api/oncall/me")).json()) as {
      shifts: Array<OncallShiftDto & { groupId: string; teamName: string }>;
    };
    expect(me.shifts[0]).toMatchObject({ groupId: group.id, teamName: "Infra", override: true });

    const removed = await call("DELETE", `/api/oncall/${group.id}/overrides/${overrideId}`);
    expect(((await removed.json()) as { group: OncallGroupDto }).group.current?.person.userId).toBe(
      "user_a",
    );
  });

  it("caps active overrides per member and per group", async () => {
    const { eq } = await import("drizzle-orm");
    as("user_a");
    const group = await createGroup("Capped");
    const override = (userId: string, index: number) =>
      call("POST", `/api/oncall/${group.id}/overrides`, {
        userId,
        startsAt: new Date(Date.now() + index * 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + (index + 1) * 3_600_000).toISOString(),
      });
    for (let index = 0; index < 20; index += 1) {
      expect((await override("user_c", index)).status).toBe(201);
    }
    const capped = await override("user_c", 20);
    expect(capped.status).toBe(409);
    const others = await db
      .select({ id: schema.oncallOverride.id })
      .from(schema.oncallOverride)
      .where(eq(schema.oncallOverride.groupId, group.id));
    expect(others).toHaveLength(20);
    await db.insert(schema.oncallOverride).values(
      Array.from({ length: 80 }, (_, index) => ({
        id: `ovr_fill_${index}`,
        groupId: group.id,
        userId: index % 2 ? "user_a" : "user_b",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(),
      })),
    );
    expect((await override("user_a", 30)).status).toBe(409);
  });
});

describe("pages", () => {
  it("pages the on-call person, merges duplicates, escalates, and lets the first acknowledgement win", async () => {
    const group = await createGroup("Escalating");
    const created = await page(group.id, {
      title: "API down",
      body: "5xx above 20%",
      dedupKey: "api-5xx",
    });
    expect(created.status).toBe(201);
    const first = (await created.json()) as OncallPageCreateResponse;
    expect(first).toMatchObject({ deduplicated: false, accepted: 1 });
    expect(first.page).toMatchObject({ status: "triggered", source: "Ana", escalationStep: 0 });
    expect(first.page.notified.map((person) => person.userId)).toEqual(["user_a"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[user_a]",
      title: "API down",
      categoryId: "HARK_PAGE_V1",
      interruptionLevel: "time-sensitive",
      data: { pageId: first.page.id, teamId: TEAM_ID, groupName: "Escalating" },
    });

    const duplicate = await page(group.id, { title: "API down", dedupKey: "api-5xx" });
    expect(duplicate.status).toBe(200);
    const merged = (await duplicate.json()) as OncallPageCreateResponse;
    expect(merged).toMatchObject({ deduplicated: true, accepted: 0 });
    expect(merged.page).toMatchObject({ id: first.page.id, repeatCount: 1 });
    expect(sent).toHaveLength(1);

    sent.length = 0;
    await runDueEscalation(first.page.id);
    expect(pushesTo("user_b")).toHaveLength(1);
    expect(sent).toHaveLength(1);
    await runDueEscalation(first.page.id);
    expect(pushesTo("user_c")).toHaveLength(1);

    const bToken = responseTokenFor("user_b");
    sent.length = 0;
    const acked = await call("POST", `/api/page-responses/${first.page.id}/acknowledge`, {
      responseToken: bToken,
    });
    expect(await acked.json()).toEqual({ ok: true, status: "acknowledged" });
    await settle();
    // The credential is single-use: replaying it answers 409 and acts on nothing.
    const replay = await call("POST", `/api/page-responses/${first.page.id}/escalate`, {
      responseToken: bToken,
    });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({
      error: "Page is already acknowledged",
      status: "acknowledged",
    });
    const reack = await call("POST", `/api/page-responses/${first.page.id}/acknowledge`, {
      responseToken: bToken,
    });
    expect(reack.status).toBe(409);
    // Everyone else who was paged gets a silent page.claimed.
    expect(sent.map((message) => message.to).sort()).toEqual([
      "ExponentPushToken[user_a]",
      "ExponentPushToken[user_c]",
    ]);
    expect(sent[0]).toMatchObject({
      _contentAvailable: true,
      data: { command: "page.claimed", pageId: first.page.id, claimedBy: "Ben" },
    });

    as("user_c");
    const late = await call("POST", `/api/pages/${first.page.id}/acknowledge`);
    expect(late.status).toBe(409);
    const detail = (await (await call("GET", `/api/pages/${first.page.id}`)).json()) as {
      page: OncallPageDto;
    };
    expect(detail.page).toMatchObject({
      status: "acknowledged",
      acknowledgedBy: { userId: "user_b" },
      nextEscalationAt: null,
      escalationStep: 2,
    });

    // Resolving closes the dedup window, so the same key pages again.
    const resolved = await call(
      "POST",
      `/api/agent/pages/${first.page.id}/resolve`,
      { note: "Rolled back" },
      WRITER,
    );
    expect(((await resolved.json()) as { page: OncallPageDto }).page.status).toBe("resolved");
    as("user_a");
    expect((await page(group.id, { title: "API down", dedupKey: "api-5xx" })).status).toBe(201);
  });

  it("escalates on request and rejects reused or foreign credentials", async () => {
    const group = await createGroup("Manual", [{ afterMinutes: 30, target: "group" }]);
    const created = (await (
      await page(group.id, { title: "Disk full" })
    ).json()) as OncallPageCreateResponse;
    const aToken = responseTokenFor("user_a");

    as("user_b");
    const escalated = await call("POST", `/api/pages/${created.page.id}/escalate`);
    const escalatedPage = ((await escalated.json()) as { page: OncallPageDto }).page;
    expect(escalatedPage.notified.map((person) => person.userId).sort()).toEqual([
      "user_a",
      "user_b",
      "user_c",
    ]);
    expect(escalatedPage.nextEscalationAt).toBeNull();
    expect((await call("POST", `/api/pages/${created.page.id}/escalate`)).status).toBe(409);

    expect(
      (
        await call("POST", `/api/page-responses/${created.page.id}/acknowledge`, {
          responseToken: "x".repeat(43),
        })
      ).status,
    ).toBe(404);
    const resolved = await call("POST", `/api/pages/${created.page.id}/resolve`, {});
    expect(resolved.status).toBe(200);
    // A credential cannot acknowledge a page that is already closed.
    expect(
      (
        await call("POST", `/api/page-responses/${created.page.id}/acknowledge`, {
          responseToken: aToken,
        })
      ).status,
    ).toBe(409);
  });

  it("falls back to the whole group when nobody is on call", async () => {
    const group = await createGroup("Future");
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.oncallGroup)
      .set({ startsAt: new Date(Date.now() + 7 * 86_400_000) })
      .where(eq(schema.oncallGroup.id, group.id));
    const created = (await (
      await page(group.id, { title: "Nobody home" })
    ).json()) as OncallPageCreateResponse;
    expect(created.page.notified.map((person) => person.userId).sort()).toEqual([
      "user_a",
      "user_b",
      "user_c",
    ]);
  });

  it("accepts pages from agents and webhooks but keeps acknowledgement human-only", async () => {
    const group = await createGroup("Automated");
    const agentPage = await call(
      "POST",
      `/api/agent/oncall/${group.id}/pages`,
      { title: "Queue backlog" },
      WRITER,
    );
    expect(agentPage.status).toBe(201);
    const { page: raised } = (await agentPage.json()) as OncallPageCreateResponse;
    expect(raised.source).toBe("Monitor bot");
    expect(
      (await call("POST", `/api/agent/oncall/${group.id}/pages`, { title: "x" }, READER)).status,
    ).toBe(403);
    expect(
      (await call("POST", `/api/agent/pages/${raised.id}/acknowledge`, {}, WRITER)).status,
    ).toBe(404);
    expect((await call("POST", `/api/agent/pages/${raised.id}/escalate`, {}, WRITER)).status).toBe(
      404,
    );

    const viaNotify = await call(
      "POST",
      "/api/agent/notifications",
      { title: "Cron failed", body: "Nightly export failed", oncall: group.id },
      WRITER,
    );
    expect(viaNotify.status).toBe(201);
    const unscoped = await call(
      "POST",
      "/api/agent/notifications",
      { body: "x", oncall: group.id },
      NOTIFIER,
    );
    expect(unscoped.status).toBe(403);
    expect(await unscoped.json()).toMatchObject({ required: ["oncall:write"] });
    expect(((await viaNotify.json()) as OncallPageCreateResponse).page.title).toBe("Cron failed");

    const hook = await call("POST", `/hooks/${WEBHOOK}`, {
      body: "Site unreachable",
      oncall: group.id,
    });
    expect(hook.status).toBe(201);
    const hookBody = (await hook.json()) as { ok: boolean; pageId: string; delivered: number };
    expect(hookBody).toMatchObject({ ok: true, delivered: 1 });
    const hookPage = (await (await call("GET", `/api/pages/${hookBody.pageId}`)).json()) as {
      page: OncallPageDto;
    };
    expect(hookPage.page).toMatchObject({
      title: "Uptime",
      body: "Site unreachable",
      source: "Uptime",
    });

    expect(
      (
        await call("POST", `/hooks/${WEBHOOK}`, {
          body: "x",
          oncall: group.id,
          deviceIds: ["dev_user_a"],
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("POST", `/hooks/${OUTSIDER_WEBHOOK}`, { body: "x", oncall: group.id })).status,
    ).toBe(404);

    const listed = await call(
      "GET",
      `/api/agent/teams/${TEAM_ID}/pages?limit=2&status=all`,
      undefined,
      READER,
    );
    const pageList = (await listed.json()) as { pages: OncallPageDto[]; nextCursor: string | null };
    expect(pageList.pages).toHaveLength(2);
    expect(pageList.nextCursor).not.toBeNull();
    const next = await call(
      "GET",
      `/api/teams/${TEAM_ID}/pages?limit=2&status=all&cursor=${pageList.nextCursor}`,
    );
    const nextList = (await next.json()) as { pages: OncallPageDto[] };
    expect(nextList.pages.map((entry) => entry.id)).not.toContain(pageList.pages[0]?.id);
    expect(nextList.pages).toHaveLength(2);
  });

  it("drops removed members from rotations", async () => {
    const group = await createGroup("Shrinking");
    expect((await call("DELETE", `/api/teams/${TEAM_ID}/members/user_c`)).status).toBe(200);
    const after = (
      (await (await call("GET", `/api/oncall/${group.id}`)).json()) as {
        group: OncallGroupDto;
      }
    ).group;
    expect(after.rotation.members.map((member) => member.userId)).toEqual(["user_a", "user_b"]);
    as("user_c");
    expect((await call("GET", `/api/oncall/${group.id}`)).status).toBe(404);
  });
});

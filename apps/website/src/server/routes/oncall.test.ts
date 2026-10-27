import type {
  OncallGroupDto,
  OncallPageCreateResponse,
  OncallPageDto,
  OncallSettingsDto,
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

/** Makes every ringing recipient of a page due now and runs the ring worker. */
async function runDueRings(pageId: string) {
  const { and, eq, isNotNull } = await import("drizzle-orm");
  await db
    .update(schema.oncallPageRecipient)
    .set({ nextRingAt: new Date(Date.now() - 1000) })
    .where(
      and(
        eq(schema.oncallPageRecipient.pageId, pageId),
        isNotNull(schema.oncallPageRecipient.nextRingAt),
      ),
    );
  await oncall.processDueRings();
}

async function pageDetail(pageId: string): Promise<OncallPageDto> {
  return ((await (await call("GET", `/api/pages/${pageId}`)).json()) as { page: OncallPageDto })
    .page;
}

describe("ringing", () => {
  it("re-alerts the paged person with the alarm sound until someone acknowledges", async () => {
    const group = await createGroup("Ringing", [{ afterMinutes: 30, target: "next" }]);
    expect(group).toMatchObject({ ringIntervalSeconds: 60, ringMaxRepeats: 10 });
    const created = (await (
      await page(group.id, { title: "DB down" })
    ).json()) as OncallPageCreateResponse;
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[user_a]",
      sound: "hark-page.caf",
      interruptionLevel: "time-sensitive",
      collapseId: `hark-page-${created.page.id}`,
    });
    expect(created.page.ringing).toMatchObject([{ person: { userId: "user_a" }, ringCount: 0 }]);
    const firstToken = responseTokenFor("user_a");

    sent.length = 0;
    await runDueRings(created.page.id);
    await runDueRings(created.page.id);
    expect(pushesTo("user_a")).toHaveLength(2);
    expect(sent).toHaveLength(2);
    // Every repeat replaces the alert on screen and still plays the alarm.
    expect(sent[1]).toMatchObject({
      sound: "hark-page.caf",
      collapseId: `hark-page-${created.page.id}`,
      data: { pageId: created.page.id, ring: 2 },
    });
    // Each repeat rotates the credential; the one just replaced still works.
    const latestToken = responseTokenFor("user_a");
    expect(latestToken).not.toBe(firstToken);
    expect(
      (
        await call("POST", `/api/page-responses/${created.page.id}/acknowledge`, {
          responseToken: firstToken,
        })
      ).status,
    ).toBe(404);
    sent.length = 0;
    const acked = await call("POST", `/api/page-responses/${created.page.id}/acknowledge`, {
      responseToken: latestToken,
    });
    expect(await acked.json()).toEqual({ ok: true, status: "acknowledged" });
    expect((await pageDetail(created.page.id)).ringing).toEqual([]);

    await runDueRings(created.page.id);
    await settle();
    expect(sent.filter((message) => message.categoryId === "HARK_PAGE_V1")).toHaveLength(0);
  });

  it("hands ringing to the next person in hand-off groups and stops after the last repeat", async () => {
    const group = await createGroup("Handoff", [{ afterMinutes: 5, target: "next" }]);
    const patched = await call("PATCH", `/api/oncall/${group.id}`, {
      ringIntervalSeconds: 30,
      ringMaxRepeats: 2,
      escalationMode: "hand_off",
    });
    expect(((await patched.json()) as { group: OncallGroupDto }).group).toMatchObject({
      ringIntervalSeconds: 30,
      ringMaxRepeats: 2,
    });
    expect(
      (await call("PATCH", `/api/oncall/${group.id}`, { ringIntervalSeconds: 10 })).status,
    ).toBe(400);

    const created = (await (
      await page(group.id, { title: "Queue stuck" })
    ).json()) as OncallPageCreateResponse;
    await runDueEscalation(created.page.id);
    const escalated = await pageDetail(created.page.id);
    expect(escalated.ringing?.map((ring) => ring.person.userId)).toEqual(["user_b"]);

    sent.length = 0;
    await runDueRings(created.page.id);
    await runDueRings(created.page.id);
    await runDueRings(created.page.id);
    expect(pushesTo("user_a")).toHaveLength(0);
    expect(pushesTo("user_b")).toHaveLength(2);
    expect((await pageDetail(created.page.id)).ringing).toEqual([]);

    expect((await call("POST", `/api/pages/${created.page.id}/resolve`, {})).status).toBe(200);
  });

  it("follows personal settings and sends critical alerts to devices that allow them", async () => {
    const group = await createGroup("Critical", [{ afterMinutes: 30, target: "group" }]);
    as("user_a");
    expect(
      (
        await call("POST", "/api/devices/alert-settings", {
          deviceId: "dev_user_a",
          criticalAlerts: "authorized",
        })
      ).status,
    ).toBe(200);
    const settings = (await (await call("GET", "/api/oncall/settings")).json()) as {
      settings: OncallSettingsDto;
    };
    expect(settings.settings).toMatchObject({
      ringUntilAcknowledged: true,
      ringIntervalSeconds: null,
      criticalAlerts: "authorized",
    });

    sent.length = 0;
    const created = (await (
      await page(group.id, { title: "Payments failing" })
    ).json()) as OncallPageCreateResponse;
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[user_a]",
      sound: { critical: true, name: "hark-page.caf", volume: 1 },
      interruptionLevel: "critical",
    });

    // Turning ringing off silences the page that is ringing now, too.
    const updated = await call(
      "PATCH",
      "/api/agent/oncall/settings",
      { ringUntilAcknowledged: false },
      WRITER,
    );
    expect(((await updated.json()) as { settings: OncallSettingsDto }).settings).toMatchObject({
      ringUntilAcknowledged: false,
    });
    expect(
      (await call("PATCH", "/api/agent/oncall/settings", { ringUntilAcknowledged: true }, READER))
        .status,
    ).toBe(403);
    sent.length = 0;
    await runDueRings(created.page.id);
    expect(sent).toHaveLength(0);
    expect((await pageDetail(created.page.id)).ringing).toEqual([]);

    expect((await call("POST", `/api/pages/${created.page.id}/resolve`, {})).status).toBe(200);
    await call("PATCH", "/api/oncall/settings", { ringUntilAcknowledged: true });
    await call("POST", "/api/devices/alert-settings", {
      deviceId: "dev_user_a",
      criticalAlerts: "unavailable",
    });
  });
});

describe("escalation policy", () => {
  it("rejects levels that name people or groups outside the team", async () => {
    as("user_a");
    const base = {
      name: "Invalid",
      rotation: { memberIds: ["user_a"], period: "daily", handoffAt: "09:00", timezone: "UTC" },
    };
    const outsider = await call("POST", `/api/teams/${TEAM_ID}/oncall`, {
      ...base,
      escalation: [{ afterMinutes: 5, target: "people", userIds: ["user_x"] }],
    });
    expect(outsider.status).toBe(400);
    const missing = await call("POST", `/api/teams/${TEAM_ID}/oncall`, {
      ...base,
      escalation: [{ afterMinutes: 5, target: "people" }],
    });
    expect(missing.status).toBe(400);
    const foreignGroup = await call("POST", `/api/teams/${TEAM_ID}/oncall`, {
      ...base,
      escalation: [{ afterMinutes: 5, target: "oncall", groupId: "ocg_doesnotexist01" }],
    });
    expect(foreignGroup.status).toBe(400);
  });

  it("pages each level in turn, keeps earlier levels ringing, loops, then pages the team", async () => {
    const group = await createGroup("Fan-out", [
      { afterMinutes: 5, target: "next" },
      { afterMinutes: 5, target: "people", userIds: ["user_c"] },
    ]);
    expect(group.escalationMode).toBe("fan_out");
    const patched = await call("PATCH", `/api/oncall/${group.id}`, {
      escalationLoops: 1,
      escalationFinal: "team",
    });
    expect(((await patched.json()) as { group: OncallGroupDto }).group).toMatchObject({
      escalationLoops: 1,
      escalationFinal: "team",
    });
    const created = (await (
      await page(group.id, { title: "Checkout 500s" })
    ).json()) as OncallPageCreateResponse;
    expect(created.page.notified.map((person) => person.userId)).toEqual(["user_a"]);

    sent.length = 0;
    await runDueEscalation(created.page.id);
    expect(pushesTo("user_b")).toHaveLength(1);
    await runDueEscalation(created.page.id);
    expect(pushesTo("user_c")).toHaveLength(1);
    // Fan-out: every level so far is still ringing.
    expect(
      (await pageDetail(created.page.id)).ringing?.map((ring) => ring.person.userId).sort(),
    ).toEqual(["user_a", "user_b", "user_c"]);

    // Let ringing run out so the loop has to page everyone again.
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.oncallPageRecipient)
      .set({ nextRingAt: null })
      .where(eq(schema.oncallPageRecipient.pageId, created.page.id));
    sent.length = 0;
    await runDueEscalation(created.page.id); // loop 1, level 0: whoever is on call
    expect(sent.map((message) => message.to)).toEqual(["ExponentPushToken[user_a]"]);
    await runDueEscalation(created.page.id); // loop 1, level 1: next in rotation
    await runDueEscalation(created.page.id); // loop 1, level 2: user_c
    expect(sent.map((message) => message.to)).toEqual([
      "ExponentPushToken[user_a]",
      "ExponentPushToken[user_b]",
      "ExponentPushToken[user_c]",
    ]);
    await db
      .update(schema.oncallPageRecipient)
      .set({ nextRingAt: null })
      .where(eq(schema.oncallPageRecipient.pageId, created.page.id));
    sent.length = 0;
    await runDueEscalation(created.page.id); // final: the whole team
    expect(sent).toHaveLength(3);

    const done = await pageDetail(created.page.id);
    expect(done.nextEscalationAt).toBeNull();
    expect(
      done.timeline
        ?.filter((event) => event.kind === "paged")
        .map((event) => [event.level, event.loop]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    sent.length = 0;
    await runDueEscalation(created.page.id);
    expect(sent).toHaveLength(0);
    expect((await call("POST", `/api/pages/${created.page.id}/resolve`, {})).status).toBe(200);
  });

  it("lets exactly one simultaneous acknowledgement claim the page and quietly tells everyone else", async () => {
    const group = await createGroup("Claim", [{ afterMinutes: 5, target: "group" }]);
    const created = (await (
      await page(group.id, { title: "Disk 95%" })
    ).json()) as OncallPageCreateResponse;
    await runDueEscalation(created.page.id);
    const bToken = responseTokenFor("user_b");
    const cToken = responseTokenFor("user_c");
    sent.length = 0;
    const [bAck, cAck] = await Promise.all([
      call("POST", `/api/page-responses/${created.page.id}/acknowledge`, { responseToken: bToken }),
      call("POST", `/api/page-responses/${created.page.id}/acknowledge`, { responseToken: cToken }),
    ]);
    expect([bAck.status, cAck.status].sort()).toEqual([200, 409]);
    const winner = bAck.status === 200 ? "user_b" : "user_c";
    const winnerName = winner === "user_b" ? "Ben" : "Cal";
    await settle();

    const detail = await pageDetail(created.page.id);
    expect(detail).toMatchObject({ status: "acknowledged", acknowledgedBy: { userId: winner } });
    expect(detail.ringing).toEqual([]);
    expect(detail.timeline?.at(-1)).toMatchObject({
      kind: "acknowledged",
      people: [{ userId: winner }],
    });
    // Everyone else's ringing alert is replaced by a quiet notice; nobody is paged again.
    const notices = sent.filter((message) => message.to !== `ExponentPushToken[${winner}]`);
    expect(notices).toHaveLength(2);
    for (const notice of notices) {
      expect(notice).toMatchObject({
        body: `Claimed by ${winnerName}`,
        interruptionLevel: "passive",
        sound: null,
        collapseId: `hark-page-${created.page.id}`,
        data: { command: "page.claimed", pageId: created.page.id },
      });
    }
    expect(sent.filter((message) => message.categoryId === "HARK_PAGE_V1")).toHaveLength(0);
    expect((await call("POST", `/api/pages/${created.page.id}/resolve`, {})).status).toBe(200);
  });

  it("re-arms Acknowledge after a lock-screen Escalate and caps re-pages past the last level", async () => {
    const group = await createGroup("Capped re-page", [{ afterMinutes: 30, target: "next" }]);
    const created = (await (
      await page(group.id, { title: "Cache cold" })
    ).json()) as OncallPageCreateResponse;
    // Escalating from the lock screen spends Ana's credential...
    const escalated = await call("POST", `/api/page-responses/${created.page.id}/escalate`, {
      responseToken: responseTokenFor("user_a"),
    });
    expect(escalated.status).toBe(200);
    // ...but her next repeat carries a fresh one that can still acknowledge.
    sent.length = 0;
    await runDueRings(created.page.id);
    const fresh = responseTokenFor("user_a");
    expect(pushesTo("user_a")).toHaveLength(1);

    // Past the last level a person can page everyone, but not on a loop.
    const { eq } = await import("drizzle-orm");
    const stopAll = () =>
      db
        .update(schema.oncallPageRecipient)
        .set({ nextRingAt: null })
        .where(eq(schema.oncallPageRecipient.pageId, created.page.id));
    const backdate = () =>
      db
        .update(schema.oncallPageEvent)
        .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
        .where(eq(schema.oncallPageEvent.pageId, created.page.id));
    as("user_b");
    await backdate();
    expect((await call("POST", `/api/pages/${created.page.id}/escalate`)).status).toBe(200);
    await stopAll();
    expect((await call("POST", `/api/pages/${created.page.id}/escalate`)).status).toBe(409);
    await backdate();
    expect((await call("POST", `/api/pages/${created.page.id}/escalate`)).status).toBe(200);
    await stopAll();
    await backdate();
    expect((await call("POST", `/api/pages/${created.page.id}/escalate`)).status).toBe(409);

    const acked = await call("POST", `/api/page-responses/${created.page.id}/acknowledge`, {
      responseToken: fresh,
    });
    expect(acked.status).toBe(200);
  });

  it("sends low-urgency pages once, without escalating, until a person escalates them", async () => {
    const group = await createGroup("Urgency", [{ afterMinutes: 5, target: "next" }]);
    const created = (await (
      await page(group.id, { title: "Cert expires in 20 days", urgency: "low" })
    ).json()) as OncallPageCreateResponse;
    expect(created.page).toMatchObject({ urgency: "low", nextEscalationAt: null, ringing: [] });
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[user_a]",
      sound: "default",
      interruptionLevel: "active",
    });
    sent.length = 0;
    await oncall.processDueEscalations(new Date(Date.now() + 3_600_000));
    await runDueRings(created.page.id);
    expect(sent).toHaveLength(0);

    // Webhooks set it too, and it only makes sense with oncall.
    const hook = await call("POST", `/hooks/${WEBHOOK}`, {
      body: "Disk 70%",
      oncall: group.id,
      urgency: "low",
    });
    expect(hook.status).toBe(201);
    expect((await call("POST", `/hooks/${WEBHOOK}`, { body: "x", urgency: "low" })).status).toBe(
      400,
    );

    // A person escalating it decides it matters: it rings and escalates from here.
    sent.length = 0;
    as("user_c");
    expect((await call("POST", `/api/pages/${created.page.id}/escalate`)).status).toBe(200);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[user_b]",
      sound: "hark-page.caf",
      interruptionLevel: "time-sensitive",
    });
    const upgraded = await pageDetail(created.page.id);
    expect(upgraded.urgency).toBe("high");
    expect(upgraded.ringing?.map((ring) => ring.person.userId)).toEqual(["user_b"]);
    as("user_a");
    expect((await call("POST", `/api/pages/${created.page.id}/resolve`, {})).status).toBe(200);
  });

  it("jumps to the next level when a person escalates and records who did", async () => {
    const group = await createGroup("Jump", [
      { afterMinutes: 30, target: "next" },
      { afterMinutes: 30, target: "people", userIds: ["user_c"] },
    ]);
    const created = (await (
      await page(group.id, { title: "Latency" })
    ).json()) as OncallPageCreateResponse;
    sent.length = 0;
    as("user_c");
    const escalated = await call("POST", `/api/pages/${created.page.id}/escalate`);
    expect(escalated.status).toBe(200);
    expect(pushesTo("user_b")).toHaveLength(1);
    const detail = await pageDetail(created.page.id);
    expect(detail.escalationStep).toBe(1);
    expect(Date.parse(detail.nextEscalationAt ?? "") - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(detail.timeline?.at(-1)).toMatchObject({
      kind: "paged",
      level: 1,
      people: [{ userId: "user_b" }],
      escalatedBy: { userId: "user_c" },
    });
    as("user_a");
    expect((await call("POST", `/api/pages/${created.page.id}/resolve`, {})).status).toBe(200);
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

import type {
  AgentNotificationWithdrawResponse,
  ApiTokenDto,
  AppDto,
  BillingDto,
  InboxActivityPageDto,
  InboxInteractionDto,
  InboxNotificationDetailDto,
  InboxNotificationPageDto,
  InboxProjectsDto,
  ServiceCreatedResponse,
} from "@hark/contracts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const pushState = vi.hoisted(() => ({ accept: true }));

vi.mock("../lib/billing", () => ({
  getBilling: async (user: { id: string }) => ({
    configured: true,
    plan: user.id === "user_a" ? "pro" : "free",
    priceMonthly: 8,
    features: { deviceRouting: true },
    limits: {
      devices: null,
      notificationsPerMonth: 100_000,
      servicePerMinute: 10_000,
      accountPerMinute: 10_000,
    },
    usage: { notificationsRemaining: 100 },
  }),
  checkNotificationAllowance: async () => true,
  trackNotification: async () => undefined,
  hasAutumn: () => false,
  clearBillingCache: () => undefined,
  getPricingPlans: async () => ({ plans: [] }),
  createCheckout: async () => "https://example.com/checkout",
  createBillingPortal: async () => "https://example.com/portal",
}));

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    // Agent routes must never fall back to a session.
    api: { getSession: async () => null },
  },
}));

vi.mock("expo-server-sdk", () => {
  class Expo {
    chunkPushNotifications(messages: Array<Record<string, unknown>>) {
      return [messages];
    }
    async sendPushNotificationsAsync(messages: Array<Record<string, unknown>>) {
      sent.push(...messages);
      return messages.map(() =>
        pushState.accept ? { status: "ok", id: "ticket" } : { status: "error", message: "no" },
      );
    }
  }
  return { Expo, default: Expo };
});

afterEach(() => {
  sent.length = 0;
  pushState.accept = true;
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let openApi: typeof import("./agent-openapi");

const FULL = `hark_${"f".repeat(43)}`;
const READ_ONLY = `hark_${"r".repeat(43)}`;
const NONE = `hark_${"n".repeat(43)}`;
const VICTIM = `hark_${"v".repeat(43)}`;
const FOREIGN = `hark_${"x".repeat(43)}`;

const BASE = Date.parse("2026-09-01T12:00:00.000Z");

function call(method: string, path: string, secret: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  openApi = await import("./agent-openapi");
  const { hashApiToken } = await import("../lib/token");
  const { API_TOKEN_SCOPES } = await import("@hark/contracts");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date(BASE);
  await db.insert(schema.user).values(
    ["user_a", "user_b"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
  const token = (id: string, userId: string, secret: string, scopes: string[]) => ({
    id,
    userId,
    name: id,
    tokenHash: hashApiToken(secret),
    prefix: secret.slice(0, 12),
    scopes,
    createdAt: now,
  });
  await db
    .insert(schema.apiToken)
    .values([
      token("tok_full", "user_a", FULL, [...API_TOKEN_SCOPES]),
      token("tok_read", "user_a", READ_ONLY, [
        "services:read",
        "devices:read",
        "inbox:read",
        "apps:read",
        "interactions:read",
      ]),
      token("tok_none", "user_a", NONE, ["notifications:send"]),
      token("tok_victim", "user_a", VICTIM, ["events:read"]),
      token("tok_foreign", "user_b", FOREIGN, [...API_TOKEN_SCOPES]),
    ]);
  await db.insert(schema.device).values([
    {
      id: "dev_a1",
      userId: "user_a",
      expoPushToken: "ExponentPushToken[a1]",
      deviceName: "Phone",
      createdAt: now,
      lastSeenAt: now,
    },
    {
      id: "dev_a2",
      userId: "user_a",
      expoPushToken: "ExponentPushToken[a2]",
      deviceName: "Spare",
      createdAt: now,
      lastSeenAt: now,
    },
    {
      id: "dev_b",
      userId: "user_b",
      expoPushToken: "ExponentPushToken[b]",
      createdAt: now,
      lastSeenAt: now,
    },
  ]);
  await db.insert(schema.project).values({
    id: "prj_ops",
    userId: "user_a",
    name: "Ops",
    normalizedName: "ops",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.service).values({
    id: "svc_seed",
    userId: "user_a",
    title: "Monitor",
    tokenHash: "seed-hash",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.event).values(
    [0, 1, 2].map((index) => ({
      id: `evt_${index}`,
      serviceId: "svc_seed",
      title: `Event ${index}`,
      body: `Body ${index}`,
      status: "delivered",
      deliveredCount: 1,
      projectId: index === 0 ? "prj_ops" : null,
      createdAt: new Date(BASE + index * 1000),
    })),
  );
  await db.insert(schema.agentNotification).values([
    {
      id: "anot_mine",
      userId: "user_a",
      requesterTokenId: "tok_none",
      title: "Agent",
      body: "Build finished",
      acceptedCount: 1,
      createdAt: new Date(BASE + 5000),
    },
    {
      id: "anot_foreign",
      userId: "user_b",
      requesterTokenId: "tok_foreign",
      title: "Other",
      body: "Not yours",
      acceptedCount: 1,
      createdAt: new Date(BASE + 5000),
    },
  ]);
  const later = new Date(Date.now() + 3_600_000);
  await db.insert(schema.interaction).values([
    {
      id: "int_pending",
      userId: "user_a",
      requesterServiceId: "svc_seed",
      title: "Deploy",
      prompt: "Ship it?",
      kind: "approval",
      choices: ["approve", "deny"],
      actionDigest: "d".repeat(64),
      expiresAt: later,
      createdAt: now,
    },
    {
      id: "int_foreign",
      userId: "user_b",
      requesterTokenId: "tok_foreign",
      title: "Other",
      prompt: "Not yours",
      kind: "yes_no",
      choices: ["yes", "no"],
      actionDigest: "e".repeat(64),
      expiresAt: later,
      createdAt: now,
    },
  ]);
  await db.insert(schema.app).values([
    {
      id: "app_mine_0001",
      userId: "user_a",
      name: "Ops",
      url: "https://ops.example.com/",
      origin: "https://ops.example.com",
      consentedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "app_taken_001",
      userId: "user_a",
      name: "Taken",
      url: "https://taken.example.com/",
      origin: "https://taken.example.com",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "app_foreign_1",
      userId: "user_b",
      name: "Foreign",
      url: "https://foreign.example.com/",
      origin: "https://foreign.example.com",
      createdAt: now,
      updatedAt: now,
    },
  ]);
});

describe("agent OpenAPI document", () => {
  it("is public and documents every registered agent route", async () => {
    const response = await call("GET", "/api/agent/openapi.json", null);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const document = (await response.json()) as {
      openapi: string;
      servers: { url: string }[];
      paths: Record<string, Record<string, { "x-hark-scopes": string[] }>>;
    };
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers[0]?.url).toMatch(/^https?:\/\/[^/]+\/api\/agent$/);

    const prefix = openApi.AGENT_API_PREFIX;
    const registered = new Set(
      app.routes
        .filter(
          (route) =>
            route.path.startsWith(`${prefix}/`) &&
            route.method !== "ALL" &&
            !route.path.endsWith("*") &&
            route.path !== `${prefix}/openapi.json`,
        )
        .map(
          (route) =>
            `${route.method.toLowerCase()} ${route.path
              .slice(prefix.length)
              .replace(/:(\w+)/g, "{$1}")}`,
        ),
    );
    const documented = new Set(
      Object.entries(document.paths).flatMap(([path, item]) =>
        Object.keys(item).map((method) => `${method} ${path}`),
      ),
    );
    expect([...registered].filter((route) => !documented.has(route))).toEqual([]);
    expect([...documented].filter((route) => !registered.has(route))).toEqual([]);
    expect(registered.size).toBeGreaterThan(30);
  });

  it("generates request bodies from the zod contracts", async () => {
    const document = openApi.agentOpenApiDocument as unknown as {
      paths: Record<
        string,
        Record<
          string,
          { requestBody?: { content: Record<string, { schema: { properties: object } }> } }
        >
      >;
    };
    const body = document.paths["/apps/{id}"]?.patch?.requestBody?.content["application/json"];
    expect(Object.keys(body?.schema.properties ?? {}).sort()).toEqual([
      "iconUrl",
      "name",
      "project",
      "url",
    ]);
  });
});

describe("agent services", () => {
  it("gets, updates, rotates, and deletes an owned service", async () => {
    const created = await call("POST", "/api/agent/services", FULL, { title: "Deploys" });
    expect(created.status).toBe(201);
    const { service, webhookUrl } = (await created.json()) as ServiceCreatedResponse;

    const read = await call("GET", `/api/agent/services/${service.id}`, READ_ONLY);
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { service: Record<string, unknown> };
    expect(readBody.service).toMatchObject({ id: service.id, title: "Deploys" });
    // Read scopes never see the credential-bearing webhook URL.
    expect(readBody.service).not.toHaveProperty("webhookUrl");

    const updated = await call("PATCH", `/api/agent/services/${service.id}`, FULL, {
      title: "Deploy bot",
      url: "https://example.com/deploys",
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      service: { title: "Deploy bot", url: "https://example.com/deploys" },
    });
    expect((await call("PATCH", `/api/agent/services/${service.id}`, FULL, {})).status).toBe(400);

    const rotated = await call("POST", `/api/agent/services/${service.id}/rotate`, FULL);
    expect(rotated.status).toBe(200);
    const rotatedBody = (await rotated.json()) as ServiceCreatedResponse;
    expect(rotatedBody.webhookUrl).toMatch(/\/hooks\//);
    expect(rotatedBody.webhookUrl).not.toBe(webhookUrl);
    expect(rotatedBody.service.webhookUrl).toBe(rotatedBody.webhookUrl);

    expect((await call("DELETE", `/api/agent/services/${service.id}`, FULL)).status).toBe(200);
    expect((await call("GET", `/api/agent/services/${service.id}`, FULL)).status).toBe(404);
  });

  it("hides other accounts' services and enforces scopes", async () => {
    expect((await call("GET", "/api/agent/services/svc_seed", FOREIGN)).status).toBe(404);
    expect(
      (await call("PATCH", "/api/agent/services/svc_seed", FOREIGN, { title: "x" })).status,
    ).toBe(404);
    expect((await call("POST", "/api/agent/services/svc_seed/rotate", FOREIGN)).status).toBe(404);
    expect((await call("DELETE", "/api/agent/services/svc_seed", FOREIGN)).status).toBe(404);
    const denied = await call("PATCH", "/api/agent/services/svc_seed", READ_ONLY, { title: "x" });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: "Insufficient scope",
      required: ["services:write"],
    });
    expect((await call("GET", "/api/agent/services/svc_seed", null)).status).toBe(401);
  });
});

describe("agent devices", () => {
  it("removes an owned device with devices:write only", async () => {
    expect((await call("DELETE", "/api/agent/devices/dev_a2", READ_ONLY)).status).toBe(403);
    expect((await call("DELETE", "/api/agent/devices/dev_b", FULL)).status).toBe(404);
    expect((await call("DELETE", "/api/agent/devices/dev_a2", FULL)).status).toBe(200);
    const list = (await (await call("GET", "/api/agent/devices", READ_ONLY)).json()) as {
      devices: Array<{ id: string }>;
    };
    expect(list.devices.map((device) => device.id)).toEqual(["dev_a1"]);
    expect((await call("POST", "/api/agent/devices", FULL, {})).status).toBe(404);
  });
});

describe("agent inbox", () => {
  it("lists projects and pages notifications with the session DTOs", async () => {
    const projects = await call("GET", "/api/agent/inbox/projects", READ_ONLY);
    expect(projects.status).toBe(200);
    const projectsBody = (await projects.json()) as InboxProjectsDto;
    expect(projectsBody.projects.map((project) => project.name)).toContain("Ops");
    expect(projectsBody.totalUnread).toBeGreaterThanOrEqual(4);

    const first = (await (
      await call("GET", "/api/agent/inbox/notifications?limit=2", READ_ONLY)
    ).json()) as InboxNotificationPageDto;
    expect(first.items.map((item) => item.id)).toEqual(["notification:anot_mine", "event:evt_2"]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await (
      await call(
        "GET",
        `/api/agent/inbox/notifications?limit=2&cursor=${first.nextCursor}`,
        READ_ONLY,
      )
    ).json()) as InboxNotificationPageDto;
    expect(second.items.map((item) => item.id)).toEqual(["event:evt_1", "event:evt_0"]);

    const filtered = (await (
      await call("GET", "/api/agent/inbox/notifications?project=prj_ops", READ_ONLY)
    ).json()) as InboxNotificationPageDto;
    expect(filtered.items.map((item) => item.id)).toEqual(["event:evt_0"]);
    expect((await call("GET", "/api/agent/inbox/notifications?limit=0", READ_ONLY)).status).toBe(
      400,
    );

    const detail = await call("GET", "/api/agent/inbox/notifications/event:evt_1", READ_ONLY);
    expect(detail.status).toBe(200);
    expect(
      ((await detail.json()) as { notification: InboxNotificationDetailDto }).notification,
    ).toMatchObject({ body: "Body 1", sourceName: "Monitor" });
    expect(
      (await call("GET", "/api/agent/inbox/notifications/notification:anot_foreign", READ_ONLY))
        .status,
    ).toBe(404);
  });

  it("marks notifications read and unread with inbox:write", async () => {
    const path = "/api/agent/inbox/notifications/event:evt_1";
    expect((await call("POST", `${path}/read`, READ_ONLY)).status).toBe(403);
    const read = await call("POST", `${path}/read`, FULL);
    expect(await read.json()).toMatchObject({ ok: true, readAt: expect.any(String) });
    expect(await (await call("POST", `${path}/read`, FULL)).json()).toMatchObject({
      idempotent: true,
    });
    expect(await (await call("POST", `${path}/unread`, FULL)).json()).toEqual({
      ok: true,
      readAt: null,
    });
    expect(
      (await call("POST", "/api/agent/inbox/notifications/event:evt_1/read", FOREIGN)).status,
    ).toBe(404);

    const page = (await (
      await call("GET", "/api/agent/inbox/notifications", FULL)
    ).json()) as InboxNotificationPageDto;
    const readAll = await call("POST", "/api/agent/inbox/notifications/read-all", FULL, {
      readThrough: page.readThroughToken,
      project: "prj_ops",
    });
    expect(await readAll.json()).toEqual({ ok: true, updated: 1 });
    expect(
      (
        await call("POST", "/api/agent/inbox/notifications/read-all", FULL, {
          readThrough: "bogus!",
        })
      ).status,
    ).toBe(400);
  });
});

describe("agent activity feed and interactions", () => {
  it("returns the session activity feed DTO under events:read", async () => {
    const response = await call("GET", "/api/agent/activity-feed?filter=notification", VICTIM);
    expect(response.status).toBe(200);
    const body = (await response.json()) as InboxActivityPageDto;
    expect(body.pageSize).toBe(20);
    expect(body.items.every((item) => item.kind === "notification")).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(4);
    expect((await call("GET", "/api/agent/activity-feed?filter=nope", VICTIM)).status).toBe(400);
    expect((await call("GET", "/api/agent/activity-feed", READ_ONLY)).status).toBe(403);
  });

  it("lists the account's pending prompts but offers no way to answer them", async () => {
    const response = await call("GET", "/api/agent/interactions", READ_ONLY);
    expect(response.status).toBe(200);
    const { interactions } = (await response.json()) as { interactions: InboxInteractionDto[] };
    expect(interactions.map((item) => item.id)).toEqual(["int_pending"]);
    expect(interactions[0]).toMatchObject({ sourceName: "Monitor", status: "pending" });

    const respond = await call("POST", "/api/agent/interactions/int_pending/respond", FULL, {
      action: "approve",
      deviceId: "dev_a1",
      actionDigest: "d".repeat(64),
    });
    expect(respond.status).toBe(404);
  });
});

describe("agent notification withdrawal", () => {
  it("sends a silent withdraw command and marks the inbox copy read", async () => {
    expect(
      (await call("POST", "/api/agent/notifications/anot_mine/withdraw", READ_ONLY)).status,
    ).toBe(403);
    expect(
      (await call("POST", "/api/agent/notifications/anot_foreign/withdraw", FULL)).status,
    ).toBe(404);

    pushState.accept = false;
    expect((await call("POST", "/api/agent/notifications/anot_mine/withdraw", FULL)).status).toBe(
      502,
    );
    pushState.accept = true;
    sent.length = 0;

    const response = await call(
      "POST",
      "/api/agent/notifications/notification:anot_mine/withdraw",
      FULL,
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as AgentNotificationWithdrawResponse).toEqual({
      ok: true,
      notificationId: "anot_mine",
      status: "withdrawn",
      accepted: 1,
    });
    expect(sent).toEqual([
      {
        to: "ExponentPushToken[a1]",
        data: { v: 1, command: "notification.withdraw", eventId: "anot_mine" },
        _contentAvailable: true,
      },
    ]);
    const detail = (await (
      await call("GET", "/api/agent/inbox/notifications/notification:anot_mine", FULL)
    ).json()) as { notification: InboxNotificationDetailDto };
    expect(detail.notification.readAt).toEqual(expect.any(String));
  });
});

describe("agent apps", () => {
  it("reads and updates metadata but never sharing or consent", async () => {
    const read = await call("GET", "/api/agent/apps/app_mine_0001", READ_ONLY);
    expect(read.status).toBe(200);
    expect((await call("GET", "/api/agent/apps/app_foreign_1", FULL)).status).toBe(404);

    const renamed = await call("PATCH", "/api/agent/apps/app_mine_0001", FULL, {
      name: "Ops board",
      project: "Ops",
      url: "https://ops.example.com/board",
    });
    expect(renamed.status).toBe(200);
    const renamedApp = ((await renamed.json()) as { app: AppDto }).app;
    expect(renamedApp).toMatchObject({
      name: "Ops board",
      projectId: "prj_ops",
      url: "https://ops.example.com/board",
    });
    // Same origin: the owner's approval still applies.
    expect(renamedApp.consentedAt).toEqual(expect.any(String));

    for (const body of [{ shareEmail: true }, { consent: true }, { name: "x", shareName: false }]) {
      expect((await call("PATCH", "/api/agent/apps/app_mine_0001", FULL, body)).status).toBe(400);
    }
    expect(
      (
        await call("PATCH", "/api/agent/apps/app_mine_0001", FULL, {
          url: "https://taken.example.com/",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("PATCH", "/api/agent/apps/app_foreign_1", FULL, { name: "Mine" })).status,
    ).toBe(404);

    const moved = await call("PATCH", "/api/agent/apps/app_mine_0001", FULL, {
      url: "https://new.example.com/",
      project: null,
      iconUrl: null,
    });
    const movedApp = ((await moved.json()) as { app: AppDto }).app;
    expect(movedApp).toMatchObject({
      origin: "https://new.example.com",
      consentedAt: null,
      projectId: null,
      iconUrl: null,
    });
  });

  it("revokes sign-in and exposes no pass issuance", async () => {
    await db
      .update(schema.app)
      .set({ consentedAt: new Date() })
      .where((await import("drizzle-orm")).eq(schema.app.id, "app_taken_001"));
    expect((await call("POST", "/api/agent/apps/app_taken_001/revoke", READ_ONLY)).status).toBe(
      403,
    );
    const revoked = await call("POST", "/api/agent/apps/app_taken_001/revoke", FULL);
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { app: AppDto }).app.consentedAt).toBeNull();
    expect((await call("POST", "/api/agent/apps/app_foreign_1/revoke", FULL)).status).toBe(404);
    expect((await call("POST", "/api/agent/apps/app_taken_001/pass", FULL, {})).status).toBe(404);
  });
});

describe("agent billing", () => {
  it("returns the session billing DTO under billing:read only", async () => {
    const response = await call("GET", "/api/agent/billing", FULL);
    expect(response.status).toBe(200);
    expect((await response.json()) as BillingDto).toMatchObject({ plan: "pro", configured: true });
    expect((await call("GET", "/api/agent/billing", READ_ONLY)).status).toBe(403);
    expect((await call("POST", "/api/agent/billing/checkout", FULL)).status).toBe(404);
    expect((await call("POST", "/api/agent/billing/portal", FULL)).status).toBe(404);
  });
});

describe("agent token management", () => {
  it("lists tokens without secrets and revokes another token of the account", async () => {
    expect((await call("GET", "/api/agent/tokens", READ_ONLY)).status).toBe(403);
    const response = await call("GET", "/api/agent/tokens", FULL);
    expect(response.status).toBe(200);
    const { tokens } = (await response.json()) as { tokens: ApiTokenDto[] };
    expect(tokens.map((token) => token.id).sort()).toEqual([
      "tok_full",
      "tok_none",
      "tok_read",
      "tok_victim",
    ]);
    const serialized = JSON.stringify(tokens);
    for (const secret of [FULL, READ_ONLY, NONE, VICTIM]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("tokenHash");

    expect((await call("DELETE", "/api/agent/tokens/tok_foreign", FULL)).status).toBe(404);
    expect((await call("GET", "/api/agent/auth/status", VICTIM)).status).toBe(200);
    expect((await call("DELETE", "/api/agent/tokens/tok_victim", FULL)).status).toBe(200);
    expect((await call("GET", "/api/agent/auth/status", VICTIM)).status).toBe(401);
    expect((await call("DELETE", "/api/agent/tokens/tok_victim", FULL)).status).toBe(404);
  });

  it("cannot create tokens", async () => {
    const response = await call("POST", "/api/agent/tokens", FULL, {
      name: "escalated",
      scopes: ["tokens:manage"],
    });
    expect(response.status).toBe(404);
  });
});

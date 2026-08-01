import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

let authenticated = false;
vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authenticated
          ? { user: { id: "analytics_user", name: "Analytics", email: "analytics@example.com" } }
          : null,
    },
  },
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
});

beforeEach(async () => {
  authenticated = false;
  await db.delete(schema.analyticsEvent);
  await db.delete(schema.analyticsDaily);
  await db.delete(schema.analyticsUserDay);
});

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "event_123456789012",
    anonymousId: "visitor_1234567890",
    sessionId: "session_1234567890",
    surface: "web",
    name: "page_view",
    path: "/pricing",
    properties: { source: "launch", referrerHost: "example.com" },
    ...overrides,
  };
}

async function send(body: unknown, headers: Record<string, string> = {}) {
  return app.request("http://localhost/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/analytics/events", () => {
  it("accepts anonymous events and deduplicates retries", async () => {
    expect((await send(event(), { origin: "http://localhost:5173" })).status).toBe(200);
    expect(await (await send(event())).json()).toMatchObject({ ok: true, accepted: false });
    const rows = await db.select().from(schema.analyticsEvent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "page_view",
      anonymousId: "visitor_1234567890",
      sessionId: "session_1234567890",
      surface: "web",
      userId: null,
    });
    expect(JSON.parse(rows[0]?.metadata ?? "{}")).toEqual({
      path: "/pricing",
      referrerHost: "example.com",
      source: "launch",
    });
  });

  it("links identity from the server session rather than the request", async () => {
    authenticated = true;
    expect((await send(event())).status).toBe(200);
    const rows = await db.select().from(schema.analyticsEvent);
    expect(rows[0]?.userId).toBe("analytics_user");
  });

  it("rejects sensitive paths, unknown properties, and foreign origins", async () => {
    expect((await send(event({ path: "/cli/authorize?code=secret" }))).status).toBe(400);
    expect((await send(event({ properties: { email: "private@example.com" } }))).status).toBe(400);
    expect((await send(event(), { origin: "https://attacker.example" })).status).toBe(403);
    expect(await db.select().from(schema.analyticsEvent)).toHaveLength(0);
  });
});

import {
  API_ERROR_CODE_CONSENT_REQUIRED,
  APP_PASS_JWKS_PATH,
  type AppCreateResponse,
  type AppDto,
  type AppPassResponse,
  appCreateSchema,
  appLaunchSchema,
  appOrigin,
  appShareSchema,
  appSharingSchema,
  appUpdateSchema,
  MAX_APPS_PER_ACCOUNT,
} from "@hark/contracts";
import { and, count, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { app, appMemberState } from "../db/schema";
import { issueAppPass, publicJwks } from "../lib/app-pass";
import {
  type AppRow,
  appAccess,
  canManageApp,
  selectAppsWithJoins,
  toAppDto,
  visibleAppDto,
  visibleAppsFilter,
} from "../lib/apps";
import { newId } from "../lib/id";
import { resolveProjectForDelivery } from "../lib/projects";
import { hasRole, memberIds, membership, returnAppToAdder, sendNotice } from "../lib/teams";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";
import { type Actor, agentActor, type Outcome, readJson, send } from "./teams";

const NOT_FOUND = { error: "App not found" } as const;
const APP_LIMIT_ERROR = `App limit reached (${MAX_APPS_PER_ACCOUNT} per account). Remove an app before adding another.`;
const FORBIDDEN_MANAGE = {
  error: "Only the person who added this app or a team admin can change it",
} as const;

// Passes are cheap to sign but each one is a bearer credential; bound how many
// a single session can mint.
const PASS_RATE_WINDOW_MS = 60_000;
const PASS_RATE_LIMIT = 30;
const passRates = new Map<string, { startedAt: number; count: number }>();

function passRateLimited(userId: string): boolean {
  const now = Date.now();
  const current = passRates.get(userId);
  if (!current || now - current.startedAt >= PASS_RATE_WINDOW_MS) {
    if (passRates.size > 10_000) passRates.clear();
    passRates.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > PASS_RATE_LIMIT;
}

/** Accepts an empty body as `{}` so the simple launch call needs no payload. */
async function optionalJson(request: { text(): Promise<string> }): Promise<unknown> {
  const text = await request.text().catch(() => null);
  if (text === null) return null;
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Personal apps first by recency of the viewer's own opens, then newest. */
async function listVisibleApps(viewerId: string): Promise<AppDto[]> {
  const rows = await selectAppsWithJoins(viewerId).where(visibleAppsFilter(viewerId));
  return rows
    .map((row) => toAppDto(row, viewerId))
    .sort((a, b) => {
      if ((a.lastOpenedAt === null) !== (b.lastOpenedAt === null)) {
        return a.lastOpenedAt === null ? 1 : -1;
      }
      return (
        (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "") ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id)
      );
    });
}

type DeleteOutcome = "deleted" | "not_found" | "forbidden";

async function deleteVisibleApp(viewerId: string, appId: string): Promise<DeleteOutcome> {
  const access = await appAccess(viewerId, appId);
  if (!access) return "not_found";
  if (!canManageApp(viewerId, access)) return "forbidden";
  await db.delete(app).where(eq(app.id, appId));
  return "deleted";
}

/** Clears the viewer's sign-in consent; the app asks again on their next open. */
async function revokeAppConsent(viewerId: string, appId: string): Promise<boolean> {
  const access = await appAccess(viewerId, appId);
  if (!access) return false;
  if (access.app.teamId) {
    await db
      .update(appMemberState)
      .set({ consentedAt: null, updatedAt: new Date() })
      .where(and(eq(appMemberState.appId, appId), eq(appMemberState.userId, viewerId)));
  } else {
    await db.update(app).set({ consentedAt: null, updatedAt: new Date() }).where(eq(app.id, appId));
  }
  return true;
}

/** Writes the viewer's sharing/consent/open state for a team app. */
async function upsertMemberState(
  appId: string,
  userId: string,
  values: Partial<Omit<typeof appMemberState.$inferInsert, "appId" | "userId">>,
): Promise<void> {
  const now = new Date();
  await db
    .insert(appMemberState)
    .values({ appId, userId, ...values, updatedAt: now })
    .onConflictDoUpdate({
      target: [appMemberState.appId, appMemberState.userId],
      set: { ...values, updatedAt: now },
    });
}

async function notifyTeamOfApp(actor: Actor, row: AppRow, teamId: string, teamName: string) {
  const recipients = (await memberIds(teamId)).filter((id) => id !== actor.id);
  await sendNotice(recipients, {
    title: `${actor.name} added ${row.name} to ${teamName}`,
    body: `Tap to open ${row.name} in Hark.`,
    sourceName: teamName,
    appId: row.id,
    conversationKey: `team-${teamId}`,
  }).catch((error: unknown) => console.error("[apps] Share notice failed", error));
}

/**
 * Moves an app into a team (`teamId`) or back to the adder's own apps
 * (`null`). Only the person who added the app can move it; other members
 * keep using it while it belongs to the team.
 */
async function shareApp(actor: Actor, appId: string, input: unknown): Promise<Outcome> {
  const parsed = appShareSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 400, body: { error: "Invalid share request", issues: parsed.error.issues } };
  }
  const access = await appAccess(actor.id, appId);
  if (!access) return { status: 404, body: NOT_FOUND };
  const current = access.app;
  if (current.userId !== actor.id) {
    return { status: 403, body: { error: "Only the person who added this app can move it" } };
  }
  const target = parsed.data.teamId;
  if (target === current.teamId) {
    return { status: 200, body: { app: await visibleAppDto(actor.id, appId) } };
  }

  if (target === null) {
    db.transaction((tx) => returnAppToAdder(tx, current));
    return { status: 200, body: { app: await visibleAppDto(actor.id, appId) } };
  }

  const destination = await membership(target, actor.id);
  if (!destination) return { status: 404, body: { error: "Team not found" } };
  const now = new Date();
  db.transaction((tx) => {
    if (current.teamId === null) {
      // The adder keeps their own sign-in decision as their member state.
      tx.insert(appMemberState)
        .values({
          appId,
          userId: actor.id,
          shareName: current.shareName,
          shareEmail: current.shareEmail,
          consentedAt: current.consentedAt,
          lastOpenedAt: current.lastOpenedAt,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    } else {
      // Members of the previous team lose their state; the adder keeps theirs.
      tx.delete(appMemberState)
        .where(and(eq(appMemberState.appId, appId), ne(appMemberState.userId, actor.id)))
        .run();
    }
    tx.update(app).set({ teamId: target, updatedAt: now }).where(eq(app.id, appId)).run();
  });
  if (parsed.data.notify !== false) {
    void notifyTeamOfApp(actor, current, target, destination.team.name);
  }
  return { status: 200, body: { app: await visibleAppDto(actor.id, appId) } };
}

export const appsAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/", requireScopes("apps:read"), async (c) =>
    c.json({ apps: await listVisibleApps(c.get("apiToken").userId) }),
  )
  .post("/", requireScopes("apps:write"), async (c) => {
    const token = c.get("apiToken");
    const parsed = appCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid app", issues: parsed.error.issues }, 400);
    }
    const input = parsed.data;
    const destination = input.teamId ? await membership(input.teamId, token.userId) : undefined;
    if (input.teamId && !destination) return c.json({ error: "Team not found" }, 404);
    const teamId = destination?.team.id ?? null;
    const projectResolution = input.project
      ? await resolveProjectForDelivery(token.userId, input.project)
      : undefined;
    const now = new Date();

    // Synchronous transaction: the existence check, cap check, and write
    // cannot interleave with another request on the single SQLite connection.
    const outcome = db.transaction((tx) => {
      const existing = tx
        .select({ id: app.id, teamId: app.teamId, userId: app.userId })
        .from(app)
        .where(
          teamId
            ? and(eq(app.teamId, teamId), eq(app.url, input.url))
            : and(eq(app.userId, token.userId), eq(app.url, input.url)),
        )
        .get();
      if (existing && existing.teamId === teamId) {
        // Same rule as PATCH: only whoever added the app or a team admin may
        // change it, and only the app's owner may move it to their project.
        const ownsExisting = existing.userId === token.userId;
        if (!ownsExisting && !(destination && hasRole(destination.role, "admin"))) {
          return { kind: "forbidden" as const };
        }
        tx.update(app)
          .set({
            name: input.name,
            ...(input.iconUrl !== undefined ? { iconUrl: input.iconUrl } : {}),
            ...(projectResolution && ownsExisting
              ? { projectId: projectResolution.projectId }
              : {}),
            updatedAt: now,
          })
          .where(eq(app.id, existing.id))
          .run();
        return { kind: "updated" as const, id: existing.id };
      }
      if (existing) return { kind: "shared_elsewhere" as const };
      const sameUrl = tx
        .select({ id: app.id })
        .from(app)
        .where(and(eq(app.userId, token.userId), eq(app.url, input.url)))
        .get();
      if (sameUrl) return { kind: "conflict" as const, id: sameUrl.id };
      const total = tx
        .select({ value: count() })
        .from(app)
        .where(eq(app.userId, token.userId))
        .get();
      if ((total?.value ?? 0) >= MAX_APPS_PER_ACCOUNT) return { kind: "limit" as const };
      const id = newId("app");
      tx.insert(app)
        .values({
          id,
          userId: token.userId,
          name: input.name,
          url: input.url,
          origin: appOrigin(input.url),
          iconUrl: input.iconUrl ?? null,
          projectId: projectResolution?.projectId ?? null,
          createdByTokenId: token.id,
          teamId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return { kind: "created" as const, id };
    });

    if (outcome.kind === "limit") return c.json({ error: APP_LIMIT_ERROR }, 409);
    if (outcome.kind === "forbidden") {
      return c.json(
        {
          error:
            "This team already has an app at this URL, added by someone else; only they or a team admin can change it",
        },
        409,
      );
    }
    if (outcome.kind === "shared_elsewhere")
      return c.json({ error: "Another app already uses this URL" }, 409);
    if (outcome.kind === "conflict") {
      return c.json(
        {
          error: `You already registered this URL as ${outcome.id}; share it with POST /api/agent/apps/${outcome.id}/share`,
        },
        409,
      );
    }
    const dto = await visibleAppDto(token.userId, outcome.id);
    if (!dto) return c.json(NOT_FOUND, 404);
    if (outcome.kind === "created" && destination) {
      const actor = await agentActor(c);
      const [row] = await db.select().from(app).where(eq(app.id, outcome.id)).limit(1);
      if (actor && row)
        void notifyTeamOfApp(actor, row, destination.team.id, destination.team.name);
    }
    const body: AppCreateResponse & { message?: string } = {
      app: dto,
      created: outcome.kind === "created",
      ...(projectResolution?.message ? { message: projectResolution.message } : {}),
    };
    return c.json(body, outcome.kind === "created" ? 201 : 200);
  })
  .get("/:id", requireScopes("apps:read"), async (c) => {
    const dto = await visibleAppDto(c.get("apiToken").userId, c.req.param("id"));
    if (!dto) return c.json(NOT_FOUND, 404);
    return c.json({ app: dto });
  })
  // Metadata only: sharing preferences and consent are owner decisions made
  // on the phone, and pass issuance is never available to agent tokens.
  .patch("/:id", requireScopes("apps:write"), async (c) => {
    const userId = c.get("apiToken").userId;
    const appId = c.req.param("id");
    const parsed = appUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid app", issues: parsed.error.issues }, 400);
    }
    const input = parsed.data;
    const access = await appAccess(userId, appId);
    if (!access) return c.json(NOT_FOUND, 404);
    if (!canManageApp(userId, access)) return c.json(FORBIDDEN_MANAGE, 403);
    const current = access.app;
    const projectResolution =
      typeof input.project === "string" && current.userId === userId
        ? await resolveProjectForDelivery(userId, input.project)
        : undefined;
    const origin = input.url === undefined ? current.origin : appOrigin(input.url);

    const outcome = db.transaction((tx) => {
      if (input.url !== undefined) {
        const duplicate = tx
          .select({ id: app.id })
          .from(app)
          .where(
            and(eq(app.userId, current.userId), eq(app.url, input.url), ne(app.id, current.id)),
          )
          .get();
        if (duplicate) return "duplicate" as const;
      }
      tx.update(app)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.url !== undefined ? { url: input.url, origin } : {}),
          // A new origin is a different site: the owner approves it before
          // it can receive a pass, exactly as on first open.
          ...(origin !== current.origin ? { consentedAt: null } : {}),
          ...(input.iconUrl !== undefined ? { iconUrl: input.iconUrl } : {}),
          ...(input.project === null && current.userId === userId ? { projectId: null } : {}),
          ...(projectResolution ? { projectId: projectResolution.projectId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(app.id, current.id))
        .run();
      // Every member approves the new site again, too.
      if (origin !== current.origin) {
        tx.update(appMemberState)
          .set({ consentedAt: null })
          .where(eq(appMemberState.appId, current.id))
          .run();
      }
      return "updated" as const;
    });
    if (outcome === "duplicate") {
      return c.json({ error: "Another app already uses this URL" }, 409);
    }
    const dto = await visibleAppDto(userId, current.id);
    if (!dto) return c.json(NOT_FOUND, 404);
    return c.json({
      app: dto,
      ...(projectResolution?.message ? { message: projectResolution.message } : {}),
    });
  })
  // Reducing access is safe to delegate; granting it is not, so there is no
  // agent route that approves sign-in or issues a pass.
  .post("/:id/revoke", requireScopes("apps:write"), async (c) => {
    const userId = c.get("apiToken").userId;
    if (!(await revokeAppConsent(userId, c.req.param("id")))) return c.json(NOT_FOUND, 404);
    return c.json({ app: await visibleAppDto(userId, c.req.param("id")) });
  })
  .post("/:id/share", requireScopes("apps:write"), async (c) => {
    const actor = await agentActor(c);
    if (!actor) return c.json({ error: "Account not found" }, 404);
    return send(c, await shareApp(actor, c.req.param("id"), await readJson(c)));
  })
  .delete("/:id", requireScopes("apps:write"), async (c) => {
    const outcome = await deleteVisibleApp(c.get("apiToken").userId, c.req.param("id"));
    if (outcome === "not_found") return c.json(NOT_FOUND, 404);
    if (outcome === "forbidden") return c.json(FORBIDDEN_MANAGE, 403);
    return c.json({ ok: true });
  });

export const appsSessionRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json({ apps: await listVisibleApps(c.get("user").id) }))
  .get("/:id", async (c) => {
    const dto = await visibleAppDto(c.get("user").id, c.req.param("id"));
    if (!dto) return c.json(NOT_FOUND, 404);
    return c.json({ app: dto });
  })
  .patch("/:id", async (c) => {
    const userId = c.get("user").id;
    const parsed = appSharingSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid sharing settings", issues: parsed.error.issues }, 400);
    }
    const access = await appAccess(userId, c.req.param("id"));
    if (!access) return c.json(NOT_FOUND, 404);
    if (access.app.teamId) {
      await upsertMemberState(access.app.id, userId, parsed.data);
    } else {
      await db
        .update(app)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(app.id, access.app.id));
    }
    return c.json({ app: await visibleAppDto(userId, access.app.id) });
  })
  .post("/:id/pass", async (c) => {
    const user = c.get("user");
    const appId = c.req.param("id");
    const parsed = appLaunchSchema.safeParse(await optionalJson(c.req));
    if (!parsed.success) {
      return c.json({ error: "Invalid launch request", issues: parsed.error.issues }, 400);
    }
    // Membership is checked here, on every pass: a removed member can no
    // longer sign in to the team's apps.
    const access = await appAccess(user.id, appId);
    if (!access) return c.json(NOT_FOUND, 404);
    const current = access.app;
    const teamApp = current.teamId !== null;
    const [state] = teamApp
      ? await db
          .select()
          .from(appMemberState)
          .where(and(eq(appMemberState.appId, appId), eq(appMemberState.userId, user.id)))
          .limit(1)
      : [];

    const { consent, ...sharing } = parsed.data;
    const now = new Date();
    if (sharing.shareName !== undefined || sharing.shareEmail !== undefined) {
      if (teamApp) await upsertMemberState(appId, user.id, sharing);
      else
        await db
          .update(app)
          .set({ ...sharing, updatedAt: now })
          .where(eq(app.id, appId));
    }
    const consentedAt = teamApp ? (state?.consentedAt ?? null) : current.consentedAt;
    if (!consentedAt && consent !== true) {
      return c.json(
        {
          error: "Approve sign-in before opening this app",
          code: API_ERROR_CODE_CONSENT_REQUIRED,
          app: await visibleAppDto(user.id, appId),
        },
        409,
      );
    }
    if (passRateLimited(user.id)) {
      c.header("Retry-After", "60");
      return c.json({ error: "Too many sign-in passes; try again shortly" }, 429);
    }

    let shareName: boolean;
    let shareEmail: boolean;
    if (teamApp) {
      await upsertMemberState(appId, user.id, {
        ...(consent === true ? { consentedAt: now } : {}),
        lastOpenedAt: now,
      });
      shareName = sharing.shareName ?? state?.shareName ?? true;
      shareEmail = sharing.shareEmail ?? state?.shareEmail ?? false;
    } else {
      const [launched] = await db
        .update(app)
        .set({ ...(consent === true ? { consentedAt: now } : {}), lastOpenedAt: now })
        .where(eq(app.id, appId))
        .returning();
      if (!launched) return c.json(NOT_FOUND, 404);
      shareName = launched.shareName;
      shareEmail = launched.shareEmail;
    }
    const pass = await issueAppPass({
      user,
      app: { id: current.id, origin: current.origin, shareName, shareEmail },
      ...(teamApp && current.teamId && access.role
        ? { team: { id: current.teamId, role: access.role } }
        : {}),
    });
    const dto = await visibleAppDto(user.id, appId);
    if (!dto) return c.json(NOT_FOUND, 404);
    return c.json<AppPassResponse>({
      token: pass.token,
      expiresAt: pass.expiresAt.toISOString(),
      app: dto,
    });
  })
  .post("/:id/revoke", async (c) => {
    const userId = c.get("user").id;
    if (!(await revokeAppConsent(userId, c.req.param("id")))) return c.json(NOT_FOUND, 404);
    return c.json({ app: await visibleAppDto(userId, c.req.param("id")) });
  })
  .post("/:id/share", async (c) => {
    const user = c.get("user");
    return send(
      c,
      await shareApp(
        { id: user.id, name: user.name, email: user.email },
        c.req.param("id"),
        await readJson(c),
      ),
    );
  })
  .delete("/:id", async (c) => {
    const outcome = await deleteVisibleApp(c.get("user").id, c.req.param("id"));
    if (outcome === "not_found") return c.json(NOT_FOUND, 404);
    if (outcome === "forbidden") return c.json(FORBIDDEN_MANAGE, 403);
    return c.json({ ok: true });
  });

/** Public keys that verify Hark passes. Mounted at the site root. */
export const appPassJwksRoute = new Hono().get(APP_PASS_JWKS_PATH, async (c) => {
  const jwks = await publicJwks();
  c.header("Cache-Control", "public, max-age=300");
  c.header("Access-Control-Allow-Origin", "*");
  return c.json(jwks);
});

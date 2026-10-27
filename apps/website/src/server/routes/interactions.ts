import { createHash } from "node:crypto";
import {
  type AgentNotificationDto,
  type AgentNotificationWithdrawResponse,
  agentNotificationCreateSchema,
  type BillingDto,
  type InboxInteractionDto,
  type InteractionDto,
  type InteractionKind,
  type InteractionStatus,
  interactionCreateSchema,
  interactionCredentialResponseSchema,
  interactionResponseSchema,
  liveActivityInteractionResponseSchema,
} from "@hark/contracts";
import { and, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  agentNotification,
  apiToken,
  device,
  event,
  interaction,
  liveActivity,
  liveActivityDelivery,
  service,
  user as userTable,
} from "../db/schema";
import { failureBucket, track } from "../lib/analytics";
import { resolveNotificationApp } from "../lib/apps";
import { checkNotificationAllowance, getBilling, trackNotification } from "../lib/billing";
import { newId } from "../lib/id";
import { deliverInteractionCallbacks } from "../lib/interaction-callbacks";
import { verifyLiveActivityInteractionCredential } from "../lib/live-activity-interaction";
import { revokeOAuthGrant } from "../lib/oauth";
import { idempotentPageConflict } from "../lib/oncall";
import { resolveProjectForDelivery } from "../lib/projects";
import { buildInteractionPushMessages, buildPushMessages, sendPushMessages } from "../lib/push";
import { hashInteractionResponseToken } from "../lib/token";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";
import {
  type AgentRateLimit,
  agentRateLimited,
  resolveInteractionLiveActivity,
  startInteractionLiveActivity,
} from "./activities";
import { pushWithdrawalCommand, verifyInteractionDeviceResponseToken } from "./hooks";
import { raisePageFor } from "./oncall";

type InteractionRow = typeof interaction.$inferSelect;

const MAX_OPEN_WAITS_PER_TOKEN = 20;
/** Open `/interactions/:id/wait` long-polls per API token. */
const openWaits = new Map<string, number>();

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toDto(row: InteractionRow): InteractionDto {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    kind: row.kind as InteractionKind,
    presentation: row.presentation === "live_activity" ? "live_activity" : "notification",
    status: row.status as InteractionStatus,
    choices: row.choices,
    response: row.response,
    imageUrl: row.imageUrl,
    url: row.url,
    actionDigest: row.actionDigest,
    primaryLabel: row.primaryLabel,
    secondaryLabel: row.secondaryLabel,
    accepted: row.acceptedCount,
    respondingDeviceId: row.respondingDeviceId,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
  };
}

async function expireIfNeeded(row: InteractionRow): Promise<InteractionRow> {
  if (row.status !== "pending" || row.expiresAt > new Date()) return row;
  const [expired] = await db
    .update(interaction)
    .set({ status: "expired" })
    .where(
      and(
        eq(interaction.id, row.id),
        eq(interaction.status, "pending"),
        lte(interaction.expiresAt, new Date()),
      ),
    )
    .returning();
  if (expired) {
    void resolveInteractionLiveActivity(expired);
    return expired;
  }
  const [current] = await db.select().from(interaction).where(eq(interaction.id, row.id)).limit(1);
  return current ?? row;
}

async function ownedInteraction(tokenId: string, id: string): Promise<InteractionRow | undefined> {
  const [row] = await db
    .select()
    .from(interaction)
    .where(and(eq(interaction.id, id), eq(interaction.requesterTokenId, tokenId)))
    .limit(1);
  return row ? expireIfNeeded(row) : undefined;
}

async function linkedLiveActivityId(interactionId: string): Promise<string | undefined> {
  const [linked] = await db
    .select({ id: liveActivity.id })
    .from(liveActivity)
    .where(eq(liveActivity.interactionId, interactionId))
    .limit(1);
  return linked?.id;
}

function idempotencyKeyFrom(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 200 ? normalized : null;
}

type NotificationRow = typeof agentNotification.$inferSelect;

function toNotificationDto(row: NotificationRow): AgentNotificationDto {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrl: row.imageUrl,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
    // Additive metadata; older clients ignore unknown keys.
    projectId: row.projectId,
    summary: row.summary,
    ...(row.bodyFormat === "markdown" ? { bodyFormat: "markdown" as const } : {}),
    ...(row.appId ? { appId: row.appId } : {}),
  };
}

type NotificationInsertOutcome =
  | { kind: "inserted"; row: NotificationRow }
  | { kind: "replayed"; row: NotificationRow }
  | { kind: "conflict" }
  | { kind: "limited"; limited: AgentRateLimit };

/**
 * Counts the agent rate windows and inserts in one synchronous transaction,
 * and absorbs idempotency-key races the same way the interaction insert does.
 */
async function insertAgentNotification(
  token: AgentEnv["Variables"]["apiToken"],
  billing: BillingDto,
  requestHash: string,
  values: typeof agentNotification.$inferInsert,
): Promise<NotificationInsertOutcome> {
  try {
    return db.transaction((tx): NotificationInsertOutcome => {
      const limited = agentRateLimited(tx, token, billing);
      if (limited) return { kind: "limited", limited };
      const inserted = tx.insert(agentNotification).values(values).returning().get();
      if (!inserted) throw new Error("Failed to create agent notification");
      return { kind: "inserted", row: inserted };
    });
  } catch (error) {
    if (values.idempotencyKey) {
      const [existing] = await db
        .select()
        .from(agentNotification)
        .where(
          and(
            eq(agentNotification.requesterTokenId, token.id),
            eq(agentNotification.idempotencyKey, values.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing?.requestHash === requestHash) return { kind: "replayed", row: existing };
      if (existing) return { kind: "conflict" };
    }
    throw error;
  }
}

/** The account's answerable prompts from every source, newest first. */
async function listPendingInteractions(userId: string): Promise<InboxInteractionDto[]> {
  const now = new Date();
  const rows = await db
    .select({
      row: interaction,
      tokenName: apiToken.name,
      serviceName: service.title,
      serviceImageUrl: service.imageUrl,
      projectId: event.projectId,
    })
    .from(interaction)
    .leftJoin(apiToken, eq(interaction.requesterTokenId, apiToken.id))
    .leftJoin(service, eq(interaction.requesterServiceId, service.id))
    .leftJoin(event, eq(interaction.eventId, event.id))
    .where(
      and(
        eq(interaction.userId, userId),
        eq(interaction.status, "pending"),
        gt(interaction.expiresAt, now),
      ),
    )
    .orderBy(desc(interaction.createdAt))
    .limit(50);
  return rows.map(({ row, tokenName, serviceName, serviceImageUrl, projectId }) => ({
    ...toDto(row),
    sourceName: serviceName ?? tokenName ?? row.title,
    sourceImageUrl: row.imageUrl ?? serviceImageUrl,
    projectId,
  }));
}

/** Accepts the bare `anot_…` ID or the inbox composite `notification:anot_…`. */
function agentNotificationIdFrom(value: string): string {
  return value.startsWith("notification:") ? value.slice("notification:".length) : value;
}

export const agentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/auth/status", (c) => {
    const token = c.get("apiToken");
    return c.json({
      authenticated: true,
      token: {
        id: token.id,
        name: token.name,
        prefix: token.prefix,
        scopes: token.scopes,
        createdAt: token.createdAt.toISOString(),
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        expiresAt: token.expiresAt?.toISOString() ?? null,
      },
    });
  })
  .post("/auth/revoke", async (c) => {
    const token = c.get("apiToken");
    if (token.oauthClientId) {
      // An MCP client signing itself out also loses its refresh tokens.
      revokeOAuthGrant(token.userId, token.oauthClientId, "agent");
      return c.json({ ok: true });
    }
    await db
      .update(apiToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiToken.id, token.id), isNull(apiToken.revokedAt)));
    track({ name: "api_token_revoked", userId: token.userId, outcome: "agent" });
    return c.json({ ok: true });
  })
  .get("/events", requireScopes("events:read"), async (c) => {
    const requested = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 50;
    const rows = await db
      .select({
        id: event.id,
        serviceId: event.serviceId,
        serviceTitle: service.title,
        title: event.title,
        body: event.body,
        imageUrl: event.imageUrl,
        url: event.url,
        status: event.status,
        deliveredCount: event.deliveredCount,
        error: event.error,
        createdAt: event.createdAt,
      })
      .from(event)
      .innerJoin(service, eq(event.serviceId, service.id))
      .where(eq(service.userId, c.get("apiToken").userId))
      .orderBy(desc(event.createdAt))
      .limit(limit);
    return c.json({
      events: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    });
  })
  .post("/notifications", requireScopes("notifications:send"), async (c) => {
    const token = c.get("apiToken");
    const parsed = agentNotificationCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid notification", issues: parsed.error.issues }, 400);
    }
    const idempotencyKey = idempotencyKeyFrom(c.req.header("Idempotency-Key"));
    if (idempotencyKey === null) {
      return c.json({ error: "Idempotency-Key must contain between 1 and 200 characters" }, 400);
    }
    if (parsed.data.urgency && !parsed.data.oncall) {
      return c.json({ error: "urgency needs oncall" }, 400);
    }
    if (parsed.data.oncall) {
      // Paging reaches other people, so it needs the on-call scope as well.
      if (!token.scopes.includes("oncall:write")) {
        return c.json({ error: "Insufficient scope", required: ["oncall:write"] }, 403);
      }
      if (parsed.data.deviceIds) {
        return c.json({ error: "oncall cannot be combined with deviceIds" }, 400);
      }
      // Pages merge on their dedup key, so an Idempotency-Key retry folds
      // into the open page instead of paging again.
      const pageInput = {
        title: parsed.data.title,
        body: parsed.data.body,
        ...(parsed.data.url ? { url: parsed.data.url } : {}),
        ...(parsed.data.appId ? { appId: parsed.data.appId } : {}),
        ...(idempotencyKey ? { dedupKey: idempotencyKey } : {}),
        ...(parsed.data.urgency ? { urgency: parsed.data.urgency } : {}),
      };
      if (
        idempotencyKey &&
        (await idempotentPageConflict(token.userId, parsed.data.oncall, pageInput))
      ) {
        return c.json({ error: "Idempotency-Key was already used with a different payload" }, 409);
      }
      const paged = await raisePageFor(token.userId, parsed.data.oncall, pageInput, token.name);
      if (!paged.ok) {
        const retryAfterSeconds =
          "retryAfterSeconds" in paged ? paged.retryAfterSeconds : undefined;
        if (retryAfterSeconds) c.header("Retry-After", String(retryAfterSeconds));
        return c.json(
          {
            error: paged.error,
            ...("issues" in paged ? { issues: paged.issues } : {}),
            ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
          },
          paged.status,
        );
      }
      return c.json(paged.body, paged.status);
    }
    const requestHash = digest(parsed.data);
    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(agentNotification)
        .where(
          and(
            eq(agentNotification.requesterTokenId, token.id),
            eq(agentNotification.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return c.json(
            { error: "Idempotency-Key was already used with a different payload" },
            409,
          );
        }
        return c.json({
          notification: toNotificationDto(existing),
          accepted: existing.acceptedCount,
          idempotent: true,
        });
      }
    }

    if (parsed.data.appId) {
      const appResolution = await resolveNotificationApp(
        token.userId,
        parsed.data.appId,
        parsed.data.url,
      );
      if (!appResolution.ok) return c.json({ error: appResolution.error }, 400);
    }

    const [owner] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, token.userId))
      .limit(1);
    if (!owner) return c.json({ error: "Account not found" }, 404);
    const billing = await getBilling(owner, true);
    if (parsed.data.deviceIds && !billing.features.deviceRouting) {
      return c.json({ error: "Device routing requires Hark Pro" }, 402);
    }

    let selectedDevices: (typeof device.$inferSelect)[];
    if (parsed.data.deviceIds) {
      const owned = await db
        .select()
        .from(device)
        .where(and(eq(device.userId, token.userId), inArray(device.id, parsed.data.deviceIds)));
      if (owned.length !== parsed.data.deviceIds.length) {
        return c.json({ error: "Invalid device selection" }, 400);
      }
      selectedDevices = owned.filter((row) => row.active && row.platform === "ios");
    } else {
      selectedDevices = await db
        .select()
        .from(device)
        .where(
          and(eq(device.userId, token.userId), eq(device.active, true), eq(device.platform, "ios")),
        )
        .orderBy(desc(device.lastSeenAt));
      if (billing.limits.devices !== null) {
        selectedDevices = selectedDevices.slice(0, billing.limits.devices);
      }
    }

    if (!(await checkNotificationAllowance(token.userId))) {
      return c.json({ error: "Monthly notification limit reached" }, 429);
    }

    // Resolved after the idempotency replay checks above and before the
    // insert below, so replays keep their originally stored project and a
    // full account never fails the delivery.
    const projectResolution = parsed.data.project
      ? await resolveProjectForDelivery(token.userId, parsed.data.project)
      : { projectId: null };

    const notificationId = newId("anot");
    const values: typeof agentNotification.$inferInsert = {
      id: notificationId,
      userId: token.userId,
      requesterTokenId: token.id,
      title: parsed.data.title,
      body: parsed.data.body,
      imageUrl: parsed.data.imageUrl ?? null,
      url: parsed.data.url ?? null,
      acceptedCount: 0,
      idempotencyKey: idempotencyKey ?? null,
      requestHash: idempotencyKey ? requestHash : null,
      projectId: projectResolution.projectId,
      bodyFormat: parsed.data.bodyFormat ?? null,
      summary: parsed.data.summary ?? null,
      appId: parsed.data.appId ?? null,
      createdAt: new Date(),
    };

    // Insert before sending so a raced duplicate replays the stored row
    // instead of double-pushing; accepted_count is settled after the send.
    const outcome = await insertAgentNotification(token, billing, requestHash, values);
    if (outcome.kind === "limited") {
      c.header("Retry-After", "60");
      return c.json(outcome.limited, 429);
    }
    if (outcome.kind === "replayed") {
      return c.json({
        notification: toNotificationDto(outcome.row),
        accepted: outcome.row.acceptedCount,
        idempotent: true,
      });
    }
    if (outcome.kind === "conflict") {
      return c.json({ error: "Idempotency-Key was already used with a different payload" }, 409);
    }

    if (selectedDevices.length === 0) {
      track({
        name: "agent_notification_created",
        userId: token.userId,
        plan: billing.plan,
        outcome: "no_devices",
      });
      return c.json(
        {
          notification: toNotificationDto(outcome.row),
          accepted: 0,
          message: [
            "No active iOS devices are registered for this account.",
            projectResolution.message,
          ]
            .filter(Boolean)
            .join(" "),
        },
        201,
      );
    }

    const messages = buildPushMessages({
      to: selectedDevices.map((selected) => selected.expoPushToken),
      eventId: notificationId,
      serviceId: token.id,
      // Thread per sender name: each distinct --title from an agent
      // connection behaves like its own source, matching per-service
      // threading on the webhook surface.
      conversationKey: `agent-${token.id}-${createHash("sha256")
        .update(parsed.data.title.trim().toLowerCase())
        .digest("hex")
        .slice(0, 10)}`,
      ...(projectResolution.projectId ? { projectId: projectResolution.projectId } : {}),
      ...(parsed.data.appId ? { appId: parsed.data.appId } : {}),
      resolved: {
        title: parsed.data.title,
        body: parsed.data.body,
        imageUrl: parsed.data.imageUrl,
        url: parsed.data.url,
        ...(parsed.data.summary !== undefined ? { summary: parsed.data.summary } : {}),
      },
    });
    const result = await sendPushMessages(messages);
    if (result.staleTokens.length > 0) {
      await db
        .update(device)
        .set({ active: false })
        .where(inArray(device.expoPushToken, result.staleTokens));
      track({
        name: "device_deactivated_stale",
        userId: token.userId,
        plan: billing.plan,
        outcome: "agent_notification",
        value: result.staleTokens.length,
      });
    }
    track({
      name: "agent_notification_created",
      userId: token.userId,
      plan: billing.plan,
      outcome: result.accepted > 0 ? "accepted" : failureBucket(result.errors[0]),
      value: result.accepted,
      metadata: { targets: messages.length },
    });
    if (result.accepted > 0) {
      track({
        name: "notification_sent",
        userId: token.userId,
        plan: billing.plan,
        outcome: "agent_notification",
        value: result.accepted,
      });
      await trackNotification(token.userId, notificationId);
    }
    await db
      .update(agentNotification)
      .set({ acceptedCount: result.accepted })
      .where(eq(agentNotification.id, notificationId));
    const messageParts = [
      // Provider errors can embed push tokens, so the reason is deliberately coarse.
      ...(result.accepted === 0 ? ["No notifications were accepted by Expo."] : []),
      ...(projectResolution.message ? [projectResolution.message] : []),
    ];
    return c.json(
      {
        notification: toNotificationDto({ ...outcome.row, acceptedCount: result.accepted }),
        accepted: result.accepted,
        ...(messageParts.length > 0 ? { message: messageParts.join(" ") } : {}),
      },
      201,
    );
  })
  // Withdrawal mirrors the webhook route: a silent command removes the push
  // from Notification Center and the inbox copy is marked read. Agent
  // notifications carry no linked prompt; cancel interactions separately.
  .post("/notifications/:id/withdraw", requireScopes("notifications:send"), async (c) => {
    const userId = c.get("apiToken").userId;
    const [row] = await db
      .select({ id: agentNotification.id })
      .from(agentNotification)
      .where(
        and(
          eq(agentNotification.id, agentNotificationIdFrom(c.req.param("id"))),
          eq(agentNotification.userId, userId),
        ),
      )
      .limit(1);
    if (!row) return c.json({ error: "Notification not found" }, 404);
    const result = await pushWithdrawalCommand(userId, row.id);
    if (result.targets > 0 && result.accepted === 0) {
      return c.json({ error: "Withdrawal delivery failed" }, 502);
    }
    await db
      .update(agentNotification)
      .set({ readAt: new Date() })
      .where(and(eq(agentNotification.id, row.id), isNull(agentNotification.readAt)));
    return c.json<AgentNotificationWithdrawResponse>({
      ok: true,
      notificationId: row.id,
      status: result.accepted < result.targets ? "withdraw_partial" : "withdrawn",
      accepted: result.accepted,
    });
  })
  .get("/interactions", requireScopes("interactions:read"), async (c) =>
    c.json({ interactions: await listPendingInteractions(c.get("apiToken").userId) }),
  )
  .post("/interactions", requireScopes("interactions:create", "notifications:send"), async (c) => {
    const token = c.get("apiToken");
    const parsed = interactionCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid interaction", issues: parsed.error.issues }, 400);
    }
    const presentation = parsed.data.presentation ?? "notification";
    const idempotencyKey = idempotencyKeyFrom(c.req.header("Idempotency-Key"));
    if (idempotencyKey === null) {
      return c.json({ error: "Idempotency-Key must contain between 1 and 200 characters" }, 400);
    }
    const requestHash = digest(parsed.data);
    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(interaction)
        .where(
          and(
            eq(interaction.requesterTokenId, token.id),
            eq(interaction.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return c.json(
            { error: "Idempotency-Key was already used with a different payload" },
            409,
          );
        }
        const current = await expireIfNeeded(existing);
        const liveActivityId = await linkedLiveActivityId(current.id);
        return c.json({
          interaction: toDto(current),
          accepted: current.acceptedCount,
          idempotent: true,
          ...(liveActivityId ? { liveActivityId } : {}),
        });
      }
    }

    const [owner] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, token.userId))
      .limit(1);
    if (!owner) return c.json({ error: "Account not found" }, 404);
    const billing = await getBilling(owner, true);
    if (parsed.data.deviceIds && !billing.features.deviceRouting) {
      return c.json({ error: "Device routing requires Hark Pro" }, 402);
    }

    let selectedDevices: (typeof device.$inferSelect)[];
    if (parsed.data.deviceIds) {
      const owned = await db
        .select()
        .from(device)
        .where(and(eq(device.userId, token.userId), inArray(device.id, parsed.data.deviceIds)));
      if (owned.length !== parsed.data.deviceIds.length) {
        return c.json({ error: "Invalid device selection" }, 400);
      }
      selectedDevices = owned.filter((row) => row.active && row.platform === "ios");
    } else {
      selectedDevices = await db
        .select()
        .from(device)
        .where(
          and(eq(device.userId, token.userId), eq(device.active, true), eq(device.platform, "ios")),
        )
        .orderBy(desc(device.lastSeenAt));
      if (billing.limits.devices !== null) {
        selectedDevices = selectedDevices.slice(0, billing.limits.devices);
      }
    }

    if (!(await checkNotificationAllowance(token.userId))) {
      return c.json({ error: "Monthly notification limit reached" }, 429);
    }

    const now = new Date();
    const interactionId = newId("int");
    const choices =
      parsed.data.kind === "approval"
        ? ["approve", "deny"]
        : parsed.data.kind === "yes_no"
          ? ["yes", "no"]
          : ["reply"];
    const liveActivityStyle = parsed.data.style ?? "approval";
    const primaryLabel =
      parsed.data.primaryLabel ??
      (parsed.data.kind === "approval"
        ? liveActivityStyle === "verdict"
          ? "Allow"
          : "Approve"
        : "Yes");
    const secondaryLabel =
      parsed.data.secondaryLabel ??
      (parsed.data.kind === "approval"
        ? liveActivityStyle === "verdict"
          ? "Don’t Allow"
          : "Deny"
        : "No");
    const actionDigest = digest({
      interactionId,
      title: parsed.data.title,
      prompt: parsed.data.prompt,
      kind: parsed.data.kind,
      choices,
      url: parsed.data.url ?? null,
      presentation,
      ...(presentation === "live_activity" ? { primaryLabel, secondaryLabel } : {}),
    });
    const values: typeof interaction.$inferInsert = {
      id: interactionId,
      userId: token.userId,
      requesterTokenId: token.id,
      title: parsed.data.title,
      prompt: parsed.data.prompt,
      kind: parsed.data.kind,
      presentation,
      status: "pending",
      choices,
      imageUrl: parsed.data.imageUrl ?? null,
      url: parsed.data.url ?? null,
      actionDigest,
      primaryLabel: presentation === "live_activity" ? primaryLabel : null,
      secondaryLabel: presentation === "live_activity" ? secondaryLabel : null,
      idempotencyKey: idempotencyKey ?? null,
      requestHash: idempotencyKey ? requestHash : null,
      expiresAt: new Date(now.getTime() + parsed.data.expiresInSeconds * 1000),
      createdAt: now,
    };
    let created: { row?: InteractionRow; limited: AgentRateLimit | null };
    try {
      // Count and insert in one synchronous transaction, so a concurrent
      // burst cannot all pass the count before any of them has inserted.
      created = db.transaction((tx) => {
        const limited = agentRateLimited(tx, token, billing);
        if (limited) return { limited };
        return { row: tx.insert(interaction).values(values).returning().get(), limited: null };
      });
    } catch (error) {
      if (idempotencyKey) {
        const [existing] = await db
          .select()
          .from(interaction)
          .where(
            and(
              eq(interaction.requesterTokenId, token.id),
              eq(interaction.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (existing?.requestHash === requestHash) {
          const liveActivityId = await linkedLiveActivityId(existing.id);
          return c.json({
            interaction: toDto(await expireIfNeeded(existing)),
            accepted: existing.acceptedCount,
            idempotent: true,
            ...(liveActivityId ? { liveActivityId } : {}),
          });
        }
        if (existing) {
          return c.json(
            { error: "Idempotency-Key was already used with a different payload" },
            409,
          );
        }
      }
      throw error;
    }
    if (created.limited) {
      c.header("Retry-After", "60");
      return c.json(created.limited, 429);
    }
    if (!created.row) return c.json({ error: "Failed to create interaction" }, 500);
    let row = created.row;
    if (selectedDevices.length === 0) {
      track({
        name: "interaction_created",
        userId: token.userId,
        plan: billing.plan,
        outcome: "no_devices",
        metadata: { kind: parsed.data.kind },
      });
      return c.json(
        {
          interaction: toDto(row),
          accepted: 0,
          message: "No active iOS devices are registered for this account.",
        },
        201,
      );
    }
    if (presentation === "live_activity") {
      const liveResult = await startInteractionLiveActivity(
        row,
        selectedDevices,
        liveActivityStyle,
      );
      const [updated] = await db
        .update(interaction)
        .set({ acceptedCount: liveResult.accepted })
        .where(eq(interaction.id, row.id))
        .returning();
      row = updated ?? row;
      track({
        name: "interaction_created",
        userId: token.userId,
        plan: billing.plan,
        outcome: liveResult.accepted > 0 ? "accepted" : failureBucket(liveResult.errors[0]),
        value: liveResult.accepted,
        metadata: { kind: parsed.data.kind, presentation: "live_activity" },
      });
      if (liveResult.accepted > 0) {
        track({
          name: "notification_sent",
          userId: token.userId,
          plan: billing.plan,
          outcome: "interaction_live_activity",
          value: liveResult.accepted,
        });
        await trackNotification(token.userId, row.id);
      }
      return c.json(
        {
          interaction: toDto(row),
          accepted: liveResult.accepted,
          ...(liveResult.activityId ? { liveActivityId: liveResult.activityId } : {}),
          ...(liveResult.accepted === 0
            ? { message: "No interactive Live Activities were accepted by APNs." }
            : {}),
        },
        201,
      );
    }
    const messages = buildInteractionPushMessages({
      to: selectedDevices.map((selected) => selected.expoPushToken),
      interactionId: row.id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      prompt: parsed.data.prompt,
      actionDigest,
      imageUrl: parsed.data.imageUrl,
      url: parsed.data.url,
    });
    const result = await sendPushMessages(messages);
    if (result.staleTokens.length > 0) {
      await db
        .update(device)
        .set({ active: false })
        .where(inArray(device.expoPushToken, result.staleTokens));
      track({
        name: "device_deactivated_stale",
        userId: token.userId,
        plan: billing.plan,
        outcome: "interaction",
        value: result.staleTokens.length,
      });
    }
    const [updated] = await db
      .update(interaction)
      .set({ acceptedCount: result.accepted })
      .where(eq(interaction.id, row.id))
      .returning();
    row = updated ?? row;
    track({
      name: "interaction_created",
      userId: token.userId,
      plan: billing.plan,
      outcome: result.accepted > 0 ? "accepted" : failureBucket(result.errors[0]),
      value: result.accepted,
      metadata: { kind: parsed.data.kind, targets: messages.length },
    });
    if (result.accepted > 0) {
      track({
        name: "notification_sent",
        userId: token.userId,
        plan: billing.plan,
        outcome: "interaction",
        value: result.accepted,
      });
      await trackNotification(token.userId, row.id);
    }
    return c.json(
      {
        interaction: toDto(row),
        accepted: result.accepted,
        // Provider errors can embed push tokens, so the reason is deliberately coarse.
        ...(result.accepted === 0 ? { message: "No notifications were accepted by Expo." } : {}),
      },
      201,
    );
  })
  .get("/interactions/:id", requireScopes("interactions:read"), async (c) => {
    const row = await ownedInteraction(c.get("apiToken").id, c.req.param("id"));
    if (!row) return c.json({ error: "Interaction not found" }, 404);
    return c.json({ interaction: toDto(row) });
  })
  .get("/interactions/:id/wait", requireScopes("interactions:read"), async (c) => {
    const requested = Number.parseFloat(c.req.query("timeout") ?? "20");
    const timeoutMs = Math.min(Math.max(Number.isFinite(requested) ? requested : 20, 0), 25) * 1000;
    const deadline = Date.now() + timeoutMs;
    const signal = c.req.raw.signal;
    // Each wait polls the database until it returns, so one token may hold
    // only a bounded number open at a time.
    const tokenId = c.get("apiToken").id;
    const open = openWaits.get(tokenId) ?? 0;
    if (open >= MAX_OPEN_WAITS_PER_TOKEN) {
      c.header("Retry-After", "1");
      return c.json({ error: "Too many concurrent waits for this token" }, 429);
    }
    openWaits.set(tokenId, open + 1);
    try {
      while (true) {
        if (signal.aborted) return new Response(null, { status: 499 });
        const row = await ownedInteraction(tokenId, c.req.param("id"));
        if (!row) return c.json({ error: "Interaction not found" }, 404);
        if (row.status !== "pending" || Date.now() >= deadline) {
          return c.json({ interaction: toDto(row), timedOut: row.status === "pending" });
        }
        const delay = Math.min(250, deadline - Date.now());
        await new Promise<void>((resolve) => {
          const onAbort = () => {
            clearTimeout(timeout);
            resolve();
          };
          const timeout = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          }, delay);
          signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    } finally {
      const remaining = (openWaits.get(tokenId) ?? 1) - 1;
      if (remaining > 0) openWaits.set(tokenId, remaining);
      else openWaits.delete(tokenId);
    }
  })
  .post("/interactions/:id/cancel", requireScopes("interactions:create"), async (c) => {
    const token = c.get("apiToken");
    const now = new Date();
    const [row] = await db
      .update(interaction)
      .set({ status: "canceled", canceledAt: now })
      .where(
        and(
          eq(interaction.id, c.req.param("id")),
          eq(interaction.requesterTokenId, token.id),
          eq(interaction.status, "pending"),
          gt(interaction.expiresAt, now),
        ),
      )
      .returning();
    if (row) {
      void resolveInteractionLiveActivity(row);
      return c.json({ interaction: toDto(row) });
    }
    const current = await ownedInteraction(token.id, c.req.param("id"));
    if (!current) return c.json({ error: "Interaction not found" }, 404);
    return c.json({ error: "Interaction is already terminal", interaction: toDto(current) }, 409);
  });

export const interactionResponseRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json({ interactions: await listPendingInteractions(c.get("user").id) }))
  .post("/:id/respond", async (c) => {
    const parsed = interactionResponseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid interaction response", issues: parsed.error.issues }, 400);
    }
    const user = c.get("user");
    const [registeredDevice] = await db
      .select({ id: device.id })
      .from(device)
      .where(
        and(
          eq(device.id, parsed.data.deviceId),
          eq(device.userId, user.id),
          eq(device.active, true),
        ),
      )
      .limit(1);
    if (!registeredDevice) return c.json({ error: "Device not found" }, 404);

    const [current] = await db
      .select()
      .from(interaction)
      .where(and(eq(interaction.id, c.req.param("id")), eq(interaction.userId, user.id)))
      .limit(1);
    if (!current) return c.json({ error: "Interaction not found" }, 404);
    if (parsed.data.actionDigest !== current.actionDigest) {
      return c.json({ error: "Interaction action digest mismatch" }, 409);
    }
    if (
      (current.kind === "approval" && !["approve", "deny"].includes(parsed.data.action)) ||
      (current.kind === "yes_no" && !["yes", "no"].includes(parsed.data.action)) ||
      (current.kind === "reply" && parsed.data.action !== "reply")
    ) {
      return c.json({ error: `This interaction requires a ${current.kind} response` }, 400);
    }

    const now = new Date();
    const status =
      parsed.data.action === "approve"
        ? "approved"
        : parsed.data.action === "deny"
          ? "denied"
          : parsed.data.action === "yes"
            ? "yes"
            : parsed.data.action === "no"
              ? "no"
              : "replied";
    const response = parsed.data.action === "reply" ? parsed.data.response : parsed.data.action;
    const [row] = await db
      .update(interaction)
      .set({
        status,
        response,
        respondingDeviceId: registeredDevice.id,
        respondedAt: now,
      })
      .where(
        and(
          eq(interaction.id, current.id),
          eq(interaction.userId, user.id),
          eq(interaction.status, "pending"),
          gt(interaction.expiresAt, now),
        ),
      )
      .returning();
    if (row) {
      track({
        name: "interaction_responded",
        userId: user.id,
        deviceId: registeredDevice.id,
        outcome: parsed.data.action,
        metadata: { kind: current.kind },
      });
      void deliverInteractionCallbacks();
      void resolveInteractionLiveActivity(row);
      return c.json({ interaction: toDto(row) });
    }

    const terminal = await expireIfNeeded(current);
    const [latest] = await db
      .select()
      .from(interaction)
      .where(eq(interaction.id, current.id))
      .limit(1);
    return c.json(
      { error: "Interaction is already terminal", interaction: toDto(latest ?? terminal) },
      409,
    );
  });

export const interactionCredentialResponseRoute = new Hono().post("/:id/respond", async (c) => {
  const parsed = interactionCredentialResponseSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: "Invalid interaction response" }, 400);
  const [current] = await db
    .select()
    .from(interaction)
    .where(eq(interaction.id, c.req.param("id")))
    .limit(1);
  // Tokens are per device, so the token itself proves which device answered.
  // Interactions pushed before per-device tokens carry one shared token.
  if (
    !current ||
    !(
      verifyInteractionDeviceResponseToken(
        parsed.data.responseToken,
        current.id,
        parsed.data.deviceId,
      ) ||
      (current.responseTokenHash !== null &&
        current.responseTokenHash === hashInteractionResponseToken(parsed.data.responseToken))
    )
  ) {
    return c.json({ error: "Interaction not found" }, 404);
  }
  const [registeredDevice] = await db
    .select({ id: device.id })
    .from(device)
    .where(
      and(
        eq(device.id, parsed.data.deviceId),
        eq(device.userId, current.userId),
        eq(device.active, true),
      ),
    )
    .limit(1);
  if (!registeredDevice) return c.json({ error: "Device not found" }, 404);
  if (
    (current.kind === "approval" && !["approve", "deny"].includes(parsed.data.action)) ||
    (current.kind === "yes_no" && !["yes", "no"].includes(parsed.data.action)) ||
    (current.kind === "reply" && parsed.data.action !== "reply")
  ) {
    return c.json({ error: "Invalid response type" }, 400);
  }
  const status =
    parsed.data.action === "approve"
      ? "approved"
      : parsed.data.action === "deny"
        ? "denied"
        : parsed.data.action === "reply"
          ? "replied"
          : parsed.data.action;
  const response = parsed.data.action === "reply" ? parsed.data.response : parsed.data.action;
  const now = new Date();
  const [row] = await db
    .update(interaction)
    .set({
      status,
      response,
      respondingDeviceId: registeredDevice.id,
      respondedAt: now,
      callbackNextAttemptAt: now,
    })
    .where(
      and(
        eq(interaction.id, current.id),
        eq(interaction.status, "pending"),
        gt(interaction.expiresAt, now),
      ),
    )
    .returning();
  if (!row) return c.json({ error: "Interaction is already terminal" }, 409);
  void deliverInteractionCallbacks();
  void resolveInteractionLiveActivity(row);
  return c.json({ ok: true, status: row.status });
});

export const liveActivityInteractionResponseRoute = new Hono().post("/:id/respond", async (c) => {
  const parsed = liveActivityInteractionResponseSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: "Invalid Live Activity response" }, 400);

  const [current] = await db
    .select({ row: interaction })
    .from(interaction)
    .innerJoin(liveActivity, eq(liveActivity.interactionId, interaction.id))
    .innerJoin(
      liveActivityDelivery,
      and(
        eq(liveActivityDelivery.activityId, liveActivity.id),
        eq(liveActivityDelivery.id, parsed.data.deliveryId),
        eq(liveActivityDelivery.deviceId, parsed.data.deviceId),
        eq(liveActivityDelivery.purpose, "interaction"),
      ),
    )
    .where(eq(interaction.id, c.req.param("id")))
    .limit(1);
  if (!current) return c.json({ error: "Interaction not found" }, 404);
  if (
    !verifyLiveActivityInteractionCredential(parsed.data.credential, {
      interactionId: current.row.id,
      deliveryId: parsed.data.deliveryId,
      deviceId: parsed.data.deviceId,
      actionDigest: current.row.actionDigest,
      expiresAt: current.row.expiresAt,
    })
  ) {
    return c.json({ error: "Interaction not found" }, 404);
  }

  const [registeredDevice] = await db
    .select({ id: device.id })
    .from(device)
    .where(
      and(
        eq(device.id, parsed.data.deviceId),
        eq(device.userId, current.row.userId),
        eq(device.active, true),
        eq(device.liveActivityInteractionVersion, 1),
      ),
    )
    .limit(1);
  if (!registeredDevice) return c.json({ error: "Device not found" }, 404);
  if (
    (current.row.kind === "approval" && !["approve", "deny"].includes(parsed.data.action)) ||
    (current.row.kind === "yes_no" && !["yes", "no"].includes(parsed.data.action)) ||
    current.row.kind === "reply"
  ) {
    return c.json({ error: "Invalid response type" }, 400);
  }

  const status =
    parsed.data.action === "approve"
      ? "approved"
      : parsed.data.action === "deny"
        ? "denied"
        : parsed.data.action;
  if (current.row.status !== "pending") {
    if (current.row.status === status && current.row.respondingDeviceId === registeredDevice.id) {
      return c.json({ ok: true, status: current.row.status, idempotent: true });
    }
    return c.json({ error: "Interaction is already terminal", status: current.row.status }, 409);
  }

  const now = new Date();
  const [row] = await db
    .update(interaction)
    .set({
      status,
      response: parsed.data.action,
      respondingDeviceId: registeredDevice.id,
      respondedAt: now,
      callbackNextAttemptAt: now,
    })
    .where(
      and(
        eq(interaction.id, current.row.id),
        eq(interaction.status, "pending"),
        gt(interaction.expiresAt, now),
      ),
    )
    .returning();
  if (!row) {
    const terminal = await expireIfNeeded(current.row);
    const [latest] = await db
      .select()
      .from(interaction)
      .where(eq(interaction.id, current.row.id))
      .limit(1);
    return c.json(
      { error: "Interaction is already terminal", status: latest?.status ?? terminal.status },
      409,
    );
  }
  track({
    name: "interaction_responded",
    userId: row.userId,
    deviceId: registeredDevice.id,
    outcome: parsed.data.action,
    metadata: { kind: row.kind, presentation: "live_activity" },
  });
  void deliverInteractionCallbacks();
  void resolveInteractionLiveActivity(row);
  return c.json({ ok: true, status: row.status });
});

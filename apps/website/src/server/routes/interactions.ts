import { createHash } from "node:crypto";
import {
  type InteractionDto,
  type InteractionKind,
  type InteractionStatus,
  interactionCreateSchema,
  interactionCredentialResponseSchema,
  interactionResponseSchema,
} from "@hark/contracts";
import { and, count, desc, eq, gt, gte, inArray, isNull, lte } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  agentNotification,
  apiToken,
  device,
  event,
  interaction,
  liveActivity,
  liveActivityOperation,
  service,
  user as userTable,
} from "../db/schema";
import { failureBucket, track } from "../lib/analytics";
import { checkNotificationAllowance, getBilling, trackNotification } from "../lib/billing";
import { newId } from "../lib/id";
import { deliverInteractionCallbacks } from "../lib/interaction-callbacks";
import { buildInteractionPushMessages, sendPushMessages } from "../lib/push";
import { hashInteractionResponseToken } from "../lib/token";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";

type InteractionRow = typeof interaction.$inferSelect;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toDto(row: InteractionRow): InteractionDto {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    kind: row.kind as InteractionKind,
    status: row.status as InteractionStatus,
    choices: row.choices,
    response: row.response,
    url: row.url,
    actionDigest: row.actionDigest,
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
  if (expired) return expired;
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

function idempotencyKeyFrom(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 200 ? normalized : null;
}

export const agentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/auth/status", (c) => {
    const token = c.get("apiToken");
    return c.json({
      authenticated: true,
      token: { id: token.id, name: token.name, prefix: token.prefix, scopes: token.scopes },
    });
  })
  .post("/auth/revoke", async (c) => {
    await db
      .update(apiToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiToken.id, c.get("apiToken").id), isNull(apiToken.revokedAt)));
    track({ name: "api_token_revoked", userId: c.get("apiToken").userId, outcome: "agent" });
    return c.json({ ok: true });
  })
  .get("/devices", requireScopes("devices:read"), async (c) => {
    const rows = await db
      .select({
        id: device.id,
        platform: device.platform,
        deviceName: device.deviceName,
        active: device.active,
        liveActivityPushToStartTokenCiphertext: device.liveActivityPushToStartTokenCiphertext,
        liveActivityTokenEnvironment: device.liveActivityTokenEnvironment,
        liveActivityTokenUpdatedAt: device.liveActivityTokenUpdatedAt,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
      })
      .from(device)
      .where(eq(device.userId, c.get("apiToken").userId))
      .orderBy(desc(device.lastSeenAt));
    return c.json({
      devices: rows.map((row) => ({
        ...row,
        platform: "ios" as const,
        liveActivitiesCapable: Boolean(row.liveActivityPushToStartTokenCiphertext),
        liveActivityTokenEnvironment:
          row.liveActivityTokenEnvironment === "sandbox" ||
          row.liveActivityTokenEnvironment === "production"
            ? row.liveActivityTokenEnvironment
            : null,
        liveActivityTokenUpdatedAt: row.liveActivityTokenUpdatedAt?.toISOString() ?? null,
        liveActivityPushToStartTokenCiphertext: undefined,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
      })),
    });
  })
  .get("/services", requireScopes("services:read"), async (c) => {
    const rows = await db
      .select({
        id: service.id,
        title: service.title,
        imageUrl: service.imageUrl,
        url: service.url,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
      })
      .from(service)
      .where(eq(service.userId, c.get("apiToken").userId))
      .orderBy(desc(service.createdAt));
    return c.json({
      services: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
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
  .post("/interactions", requireScopes("interactions:create", "notifications:send"), async (c) => {
    const token = c.get("apiToken");
    const parsed = interactionCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid interaction", issues: parsed.error.issues }, 400);
    }
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
        return c.json({
          interaction: toDto(current),
          accepted: current.acceptedCount,
          idempotent: true,
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

    const since = new Date(Date.now() - 60_000);
    const [
      [requesterNotifications],
      [requesterUsage],
      [requesterActivityUsage],
      [accountNotifications],
      [webhookUsage],
      [interactionUsage],
      [activityUsage],
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(agentNotification)
        .where(
          and(
            eq(agentNotification.requesterTokenId, token.id),
            gte(agentNotification.createdAt, since),
          ),
        ),
      db
        .select({ value: count() })
        .from(interaction)
        .where(and(eq(interaction.requesterTokenId, token.id), gte(interaction.createdAt, since))),
      db
        .select({ value: count() })
        .from(liveActivityOperation)
        .where(
          and(
            eq(liveActivityOperation.requesterTokenId, token.id),
            gte(liveActivityOperation.createdAt, since),
          ),
        ),
      db
        .select({ value: count() })
        .from(agentNotification)
        .where(
          and(eq(agentNotification.userId, token.userId), gte(agentNotification.createdAt, since)),
        ),
      db
        .select({ value: count() })
        .from(event)
        .innerJoin(service, eq(event.serviceId, service.id))
        .where(and(eq(service.userId, token.userId), gte(event.createdAt, since))),
      db
        .select({ value: count() })
        .from(interaction)
        .where(and(eq(interaction.userId, token.userId), gte(interaction.createdAt, since))),
      db
        .select({ value: count() })
        .from(liveActivityOperation)
        .innerJoin(liveActivity, eq(liveActivity.id, liveActivityOperation.activityId))
        .where(
          and(eq(liveActivity.userId, token.userId), gte(liveActivityOperation.createdAt, since)),
        ),
    ]);
    if (
      (requesterNotifications?.value ?? 0) +
        (requesterUsage?.value ?? 0) +
        (requesterActivityUsage?.value ?? 0) >=
      billing.limits.servicePerMinute
    ) {
      c.header("Retry-After", "60");
      return c.json({ error: "Requester rate limit exceeded", retryAfterSeconds: 60 }, 429);
    }
    if (
      (accountNotifications?.value ?? 0) +
        (webhookUsage?.value ?? 0) +
        (interactionUsage?.value ?? 0) +
        (activityUsage?.value ?? 0) >=
      billing.limits.accountPerMinute
    ) {
      c.header("Retry-After", "60");
      return c.json({ error: "Account rate limit exceeded", retryAfterSeconds: 60 }, 429);
    }
    if (!(await checkNotificationAllowance(token.userId))) {
      return c.json({ error: "Monthly notification limit reached" }, 429);
    }

    const now = new Date();
    const interactionId = newId("int");
    const choices = parsed.data.kind === "approval" ? ["approve", "deny"] : ["reply"];
    const actionDigest = digest({
      interactionId,
      title: parsed.data.title,
      prompt: parsed.data.prompt,
      kind: parsed.data.kind,
      choices,
      url: parsed.data.url ?? null,
    });
    const values: typeof interaction.$inferInsert = {
      id: interactionId,
      userId: token.userId,
      requesterTokenId: token.id,
      title: parsed.data.title,
      prompt: parsed.data.prompt,
      kind: parsed.data.kind,
      status: "pending",
      choices,
      url: parsed.data.url ?? null,
      actionDigest,
      idempotencyKey: idempotencyKey ?? null,
      requestHash: idempotencyKey ? requestHash : null,
      expiresAt: new Date(now.getTime() + parsed.data.expiresInSeconds * 1000),
      createdAt: now,
    };
    let row: InteractionRow;
    try {
      const [inserted] = await db.insert(interaction).values(values).returning();
      if (!inserted) return c.json({ error: "Failed to create interaction" }, 500);
      row = inserted;
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
          return c.json({
            interaction: toDto(await expireIfNeeded(existing)),
            accepted: existing.acceptedCount,
            idempotent: true,
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
    const messages = buildInteractionPushMessages({
      to: selectedDevices.map((selected) => selected.expoPushToken),
      interactionId: row.id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      prompt: parsed.data.prompt,
      actionDigest,
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
    while (true) {
      if (signal.aborted) return new Response(null, { status: 499 });
      const row = await ownedInteraction(c.get("apiToken").id, c.req.param("id"));
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
    if (row) return c.json({ interaction: toDto(row) });
    const current = await ownedInteraction(token.id, c.req.param("id"));
    if (!current) return c.json({ error: "Interaction not found" }, 404);
    return c.json({ error: "Interaction is already terminal", interaction: toDto(current) }, 409);
  });

export const interactionResponseRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
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
    .where(
      and(
        eq(interaction.id, c.req.param("id")),
        eq(interaction.responseTokenHash, hashInteractionResponseToken(parsed.data.responseToken)),
      ),
    )
    .limit(1);
  if (!current) return c.json({ error: "Interaction not found" }, 404);
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
  return c.json({ ok: true, status: row.status });
});

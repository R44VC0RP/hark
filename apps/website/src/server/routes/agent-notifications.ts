import { createHash } from "node:crypto";
import {
  type AgentNotificationCreateResponse,
  type AgentNotificationDto,
  agentNotificationCreateSchema,
} from "@hark/contracts";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  agentNotification,
  device,
  event,
  interaction,
  liveActivity,
  liveActivityOperation,
  service,
  user,
} from "../db/schema";
import { track } from "../lib/analytics";
import { checkNotificationAllowance, getBilling, trackNotification } from "../lib/billing";
import { newId } from "../lib/id";
import { buildPushMessages, sendPushMessages } from "../lib/push";
import { type AgentEnv, requireApiToken, requireScopes } from "../middleware";

function digest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function idempotencyKeyFrom(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 200 ? normalized : null;
}

function toDto(row: typeof agentNotification.$inferSelect): AgentNotificationDto {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    accepted: row.acceptedCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function response(
  row: typeof agentNotification.$inferSelect,
  extras: Pick<AgentNotificationCreateResponse, "idempotent" | "message"> = {},
): AgentNotificationCreateResponse {
  return {
    notification: toDto(row),
    accepted: row.acceptedCount,
    ...extras,
  };
}

export const agentNotificationsRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .post("/", requireScopes("notifications:send"), async (c) => {
    const token = c.get("apiToken");
    const parsed = agentNotificationCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid notification", issues: parsed.error.issues }, 400);
    }

    const idempotencyKey = idempotencyKeyFrom(c.req.header("Idempotency-Key"));
    if (idempotencyKey === null) {
      return c.json({ error: "Idempotency-Key must contain between 1 and 200 characters" }, 400);
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
        return c.json(response(existing, { idempotent: true }));
      }
    }

    const [owner] = await db.select().from(user).where(eq(user.id, token.userId)).limit(1);
    if (!owner) return c.json({ error: "Account not found" }, 404);
    const billing = await getBilling(owner, true);
    if (parsed.data.deviceIds && !billing.features.deviceRouting) {
      return c.json({ error: "Device routing requires Hark Pro" }, 402);
    }

    let targets = await db
      .select()
      .from(device)
      .where(
        and(
          eq(device.userId, token.userId),
          eq(device.active, true),
          eq(device.platform, "ios"),
          ...(parsed.data.deviceIds ? [inArray(device.id, parsed.data.deviceIds)] : []),
        ),
      )
      .orderBy(desc(device.lastSeenAt));
    if (parsed.data.deviceIds && targets.length !== parsed.data.deviceIds.length) {
      return c.json({ error: "Invalid device selection" }, 400);
    }
    if (!parsed.data.deviceIds && billing.limits.devices !== null) {
      targets = targets.slice(0, billing.limits.devices);
    }

    const since = new Date(Date.now() - 60_000);
    const [
      [requesterNotifications],
      [requesterInteractions],
      [requesterActivities],
      [accountNotifications],
      [accountInteractions],
      [accountActivities],
      [accountEvents],
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
        .from(interaction)
        .where(and(eq(interaction.userId, token.userId), gte(interaction.createdAt, since))),
      db
        .select({ value: count() })
        .from(liveActivityOperation)
        .innerJoin(liveActivity, eq(liveActivity.id, liveActivityOperation.activityId))
        .where(
          and(eq(liveActivity.userId, token.userId), gte(liveActivityOperation.createdAt, since)),
        ),
      db
        .select({ value: count() })
        .from(event)
        .innerJoin(service, eq(event.serviceId, service.id))
        .where(and(eq(service.userId, token.userId), gte(event.createdAt, since))),
    ]);
    if (
      (requesterNotifications?.value ?? 0) +
        (requesterInteractions?.value ?? 0) +
        (requesterActivities?.value ?? 0) >=
      billing.limits.servicePerMinute
    ) {
      c.header("Retry-After", "60");
      return c.json({ error: "Requester rate limit exceeded", retryAfterSeconds: 60 }, 429);
    }
    if (
      (accountNotifications?.value ?? 0) +
        (accountInteractions?.value ?? 0) +
        (accountActivities?.value ?? 0) +
        (accountEvents?.value ?? 0) >=
      billing.limits.accountPerMinute
    ) {
      c.header("Retry-After", "60");
      return c.json({ error: "Account rate limit exceeded", retryAfterSeconds: 60 }, 429);
    }
    if (!(await checkNotificationAllowance(token.userId))) {
      return c.json({ error: "Monthly notification limit reached" }, 429);
    }

    const now = new Date();
    const values: typeof agentNotification.$inferInsert = {
      id: newId("ntf"),
      userId: token.userId,
      requesterTokenId: token.id,
      title: parsed.data.title ?? token.name,
      body: parsed.data.body,
      imageUrl: parsed.data.imageUrl ?? null,
      url: parsed.data.url ?? null,
      status: "processing",
      idempotencyKey: idempotencyKey ?? null,
      requestHash: idempotencyKey ? requestHash : null,
      createdAt: now,
    };
    let row: typeof agentNotification.$inferSelect;
    try {
      const [inserted] = await db.insert(agentNotification).values(values).returning();
      if (!inserted) return c.json({ error: "Failed to create notification" }, 500);
      row = inserted;
    } catch (error) {
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
        if (existing?.requestHash === requestHash) {
          return c.json(response(existing, { idempotent: true }));
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

    if (targets.length === 0) {
      const [updated] = await db
        .update(agentNotification)
        .set({ status: "no_devices" })
        .where(eq(agentNotification.id, row.id))
        .returning();
      return c.json(
        response(updated ?? row, {
          message: "No active iOS devices are registered for this account.",
        }),
        201,
      );
    }

    const messages = buildPushMessages({
      to: targets.map((target) => target.expoPushToken),
      eventId: row.id,
      serviceId: `agent-${token.id}`,
      resolved: {
        title: row.title,
        body: row.body,
        imageUrl: row.imageUrl ?? undefined,
        url: row.url ?? undefined,
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
    const status =
      result.accepted === messages.length ? "accepted" : result.accepted > 0 ? "partial" : "failed";
    const [updated] = await db
      .update(agentNotification)
      .set({
        status,
        acceptedCount: result.accepted,
        error: result.errors.length > 0 ? result.errors.join("; ").slice(0, 1000) : null,
      })
      .where(eq(agentNotification.id, row.id))
      .returning();
    row = updated ?? row;

    if (result.accepted > 0) {
      track({
        name: "notification_sent",
        userId: token.userId,
        plan: billing.plan,
        outcome: "agent",
        value: result.accepted,
      });
      await trackNotification(token.userId, row.id);
    }
    return c.json(
      response(row, {
        ...(result.accepted === 0 ? { message: "No notifications were accepted by Expo." } : {}),
      }),
      201,
    );
  });

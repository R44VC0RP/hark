import { createHash } from "node:crypto";
import {
  LIVE_ACTIVITY_DEFAULT_STALE_AFTER_SECONDS,
  LIVE_ACTIVITY_SCHEMA_VERSION,
  type LiveActivityProps,
  liveActivityEndSchema,
  liveActivityPropsSchema,
  liveActivityStartSchema,
  liveActivityUpdateSchema,
} from "@hark/contracts";
import { and, count, desc, eq, gte, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  agentNotification,
  device,
  event,
  interaction,
  liveActivity,
  liveActivityDelivery,
  liveActivityOperation,
  service as serviceTable,
  user as userTable,
} from "../db/schema";
import { checkNotificationAllowance, getBilling, trackNotification } from "../lib/billing";
import { newId } from "../lib/id";
import { hashWebhookToken } from "../lib/token";
import {
  type ActivityRow,
  dispatchLiveActivity,
  expireLiveActivity,
  findBlockingDeliveries,
  liveKeyedActivity,
  replaceBlockingDeliveries,
  toLiveActivityDto,
  trackActivityOutcome,
} from "./activities";

type ServiceRow = typeof serviceTable.$inferSelect;
type UserRow = typeof userTable.$inferSelect;
type DeliveryRow = typeof liveActivityDelivery.$inferSelect;
type DeliveryResult = { accepted: number; failed: number; errors: string[] };

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function idempotencyKey(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 200 ? normalized : null;
}

async function authenticate(
  token: string,
): Promise<{ service: ServiceRow; owner: UserRow } | null> {
  const [match] = await db
    .select({ service: serviceTable, owner: userTable })
    .from(serviceTable)
    .innerJoin(userTable, eq(serviceTable.userId, userTable.id))
    .where(eq(serviceTable.tokenHash, hashWebhookToken(token)))
    .limit(1);
  return match ?? null;
}

async function ownedActivity(
  serviceId: string,
  identifier: string,
): Promise<ActivityRow | undefined> {
  // Keys are reusable once an activity ends, so an identifier can match one
  // live activity plus any number of terminal ones. Prefer the live match,
  // then the most recently created terminal one.
  const [row] = await db
    .select()
    .from(liveActivity)
    .where(
      and(
        eq(liveActivity.requesterServiceId, serviceId),
        or(eq(liveActivity.id, identifier), eq(liveActivity.key, identifier)),
      ),
    )
    .orderBy(
      desc(inArray(liveActivity.status, ["starting", "active", "partial"])),
      desc(liveActivity.createdAt),
    )
    .limit(1);
  return row ? expireLiveActivity(row) : undefined;
}

async function operationReplay(serviceId: string, key: string | undefined, requestHash: string) {
  if (!key) return undefined;
  const [operation] = await db
    .select()
    .from(liveActivityOperation)
    .where(
      and(
        eq(liveActivityOperation.requesterServiceId, serviceId),
        eq(liveActivityOperation.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (!operation) return undefined;
  if (operation.requestHash !== requestHash) return { conflict: true } as const;
  const [row] = await db
    .select()
    .from(liveActivity)
    .where(eq(liveActivity.id, operation.activityId))
    .limit(1);
  return row ? ({ conflict: false, operation, row } as const) : undefined;
}

async function enforceRateLimit(service: ServiceRow, owner: UserRow) {
  const billing = await getBilling(owner, true);
  const since = new Date(Date.now() - 60_000);
  const [
    [serviceEvents],
    [serviceActivities],
    [accountNotifications],
    [accountEvents],
    [accountInteractions],
    [accountActivities],
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(event)
      .where(and(eq(event.serviceId, service.id), gte(event.createdAt, since))),
    db
      .select({ value: count() })
      .from(liveActivityOperation)
      .where(
        and(
          eq(liveActivityOperation.requesterServiceId, service.id),
          gte(liveActivityOperation.createdAt, since),
        ),
      ),
    db
      .select({ value: count() })
      .from(agentNotification)
      .where(
        and(eq(agentNotification.userId, service.userId), gte(agentNotification.createdAt, since)),
      ),
    db
      .select({ value: count() })
      .from(event)
      .innerJoin(serviceTable, eq(event.serviceId, serviceTable.id))
      .where(and(eq(serviceTable.userId, service.userId), gte(event.createdAt, since))),
    db
      .select({ value: count() })
      .from(interaction)
      .where(and(eq(interaction.userId, service.userId), gte(interaction.createdAt, since))),
    db
      .select({ value: count() })
      .from(liveActivityOperation)
      .innerJoin(liveActivity, eq(liveActivity.id, liveActivityOperation.activityId))
      .where(
        and(eq(liveActivity.userId, service.userId), gte(liveActivityOperation.createdAt, since)),
      ),
  ]);
  if (
    (serviceEvents?.value ?? 0) + (serviceActivities?.value ?? 0) >=
    billing.limits.servicePerMinute
  ) {
    return { error: "Service rate limit exceeded", retryAfterSeconds: 60 as const };
  }
  if (
    (accountNotifications?.value ?? 0) +
      (accountEvents?.value ?? 0) +
      (accountInteractions?.value ?? 0) +
      (accountActivities?.value ?? 0) >=
    billing.limits.accountPerMinute
  ) {
    return { error: "Account rate limit exceeded", retryAfterSeconds: 60 as const };
  }
  return null;
}

function response(row: ActivityRow, result?: DeliveryResult, extras: Record<string, unknown> = {}) {
  const activity = toLiveActivityDto(row);
  return {
    ok: true,
    activityId: activity.id,
    sequence: activity.sequence,
    status: activity.status,
    accepted: result?.accepted ?? activity.accepted,
    failed: result?.failed ?? activity.failed,
    state: activity.props,
    expiresAt: activity.expiresAt,
    staleAt: row.staleAt?.toISOString() ?? null,
    endedAt: activity.endedAt,
    ...extras,
  };
}

async function eligibleDevices(
  service: ServiceRow,
  owner: UserRow,
  requestedIds: string[] | undefined,
) {
  const billing = await getBilling(owner, true);
  if (requestedIds && !billing.features.deviceRouting) {
    return { error: "Device routing requires Hark Pro", status: 402 as const };
  }
  let targets = await db
    .select()
    .from(device)
    .where(
      and(
        eq(device.userId, service.userId),
        eq(device.active, true),
        eq(device.platform, "ios"),
        ...(requestedIds ? [inArray(device.id, requestedIds)] : []),
      ),
    )
    .orderBy(desc(device.lastSeenAt));
  if (requestedIds && targets.length !== requestedIds.length) {
    return { error: "Invalid device selection", status: 400 as const };
  }
  if (!requestedIds && billing.limits.devices !== null)
    targets = targets.slice(0, billing.limits.devices);
  return {
    targets: targets.filter(
      (target) =>
        target.liveActivityPushToStartTokenCiphertext &&
        target.liveActivitySchemaVersion === LIVE_ACTIVITY_SCHEMA_VERSION &&
        (target.liveActivityTokenEnvironment === "sandbox" ||
          target.liveActivityTokenEnvironment === "production"),
    ),
  };
}

async function deliveriesFor(activityId: string): Promise<DeliveryRow[]> {
  return db
    .select()
    .from(liveActivityDelivery)
    .where(
      and(
        eq(liveActivityDelivery.activityId, activityId),
        inArray(liveActivityDelivery.status, ["pending", "accepted", "active"]),
      ),
    );
}

export const activityHooksRoute = new Hono()
  .post("/:token/live-activities", async (c) => {
    const authenticated = await authenticate(c.req.param("token"));
    if (!authenticated) return c.json({ ok: false, error: "Unknown webhook" }, 404);
    const { service, owner } = authenticated;
    const parsed = liveActivityStartSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Invalid Live Activity", issues: parsed.error.issues },
        400,
      );
    }
    const key = idempotencyKey(c.req.header("Idempotency-Key"));
    if (key === null) {
      return c.json(
        { ok: false, error: "Idempotency-Key must contain between 1 and 200 characters" },
        400,
      );
    }
    const requestHash = hash(parsed.data);
    if (key) {
      const [existing] = await db
        .select()
        .from(liveActivity)
        .where(
          and(
            eq(liveActivity.requesterServiceId, service.id),
            eq(liveActivity.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return c.json(
            { ok: false, error: "Idempotency-Key was already used with a different payload" },
            409,
          );
        }
        return c.json(
          response(await expireLiveActivity(existing), undefined, { idempotent: true }),
        );
      }
    }
    const billing = await getBilling(owner, true);
    if (billing.plan !== "pro") {
      return c.json({ ok: false, error: "Live Activities require Hark Pro" }, 402);
    }
    const limited = await enforceRateLimit(service, owner);
    if (limited) {
      c.header("Retry-After", "60");
      return c.json({ ok: false, ...limited }, 429);
    }
    if (!(await checkNotificationAllowance(service.userId))) {
      return c.json({ ok: false, error: "Monthly notification limit reached" }, 429);
    }
    const targetResult = await eligibleDevices(service, owner, parsed.data.deviceIds);
    if ("error" in targetResult) {
      return c.json({ ok: false, error: targetResult.error }, targetResult.status);
    }
    const now = new Date();
    const targets = targetResult.targets;
    const blockers = await findBlockingDeliveries(
      targets.map((target) => target.id),
      now,
    );
    let replaced = 0;
    const firstBlocker = blockers[0];
    if (firstBlocker && !parsed.data.replace) {
      return c.json(
        {
          ok: false,
          error: "A Live Activity is already active on a target device",
          code: "ACTIVE_ACTIVITY_CONFLICT",
          // A blocker from another service of the same account stays
          // undisclosed; its id would leak activity of an unrelated
          // integration.
          ...(firstBlocker.activity.requesterServiceId === service.id
            ? { activityId: firstBlocker.activity.id }
            : {}),
        },
        409,
      );
    }
    const keyed = parsed.data.key
      ? await liveKeyedActivity({ requesterServiceId: service.id }, parsed.data.key)
      : undefined;
    if (keyed && !parsed.data.replace) {
      return c.json(
        {
          ok: false,
          error: "A Live Activity with this key is still active",
          code: "ACTIVE_ACTIVITY_CONFLICT",
          activityId: keyed.id,
        },
        409,
      );
    }
    if (parsed.data.replace && (firstBlocker || keyed)) {
      replaced = await replaceBlockingDeliveries(blockers, now, keyed);
    }

    const activityId = newId("act");
    const operationId = newId("lao");
    const expiresAt = new Date(now.getTime() + parsed.data.expiresInSeconds * 1000);
    const staleAt = new Date(
      Math.min(now.getTime() + parsed.data.staleAfterSeconds * 1000, expiresAt.getTime()),
    );
    const props: LiveActivityProps = {
      schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
      activityId,
      title: parsed.data.title,
      status: parsed.data.status,
      ...(parsed.data.detail ? { detail: parsed.data.detail } : {}),
      ...(parsed.data.progress !== undefined ? { progress: parsed.data.progress } : {}),
      updatedAt: now.toISOString(),
      symbol: parsed.data.symbol,
      privacyMode: parsed.data.privacyMode,
      accentColor: parsed.data.accentColor,
    };
    let created: { row: ActivityRow; deliveries: DeliveryRow[] };
    try {
      created = db.transaction((tx) => {
        const row = tx
          .insert(liveActivity)
          .values({
            id: activityId,
            userId: service.userId,
            requesterServiceId: service.id,
            key: parsed.data.key ?? null,
            schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
            props,
            status: "starting",
            sequence: 0,
            apnsTimestamp: Math.floor(now.getTime() / 1000),
            idempotencyKey: key ?? null,
            requestHash: key ? requestHash : null,
            expiresAt,
            staleAt,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        tx.insert(liveActivityOperation)
          .values({
            id: operationId,
            activityId,
            requesterServiceId: service.id,
            event: "start",
            sequence: 0,
            idempotencyKey: key ?? null,
            requestHash: key ? requestHash : null,
            createdAt: now,
          })
          .run();
        const deliveries = targets.map((target) =>
          tx
            .insert(liveActivityDelivery)
            .values({
              id: newId("lad"),
              activityId,
              deviceId: target.id,
              status: "pending",
              environment: target.liveActivityTokenEnvironment as "sandbox" | "production",
              schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get(),
        );
        return { row, deliveries };
      });
    } catch (error) {
      if (key) {
        const [existing] = await db
          .select()
          .from(liveActivity)
          .where(
            and(
              eq(liveActivity.requesterServiceId, service.id),
              eq(liveActivity.idempotencyKey, key),
            ),
          )
          .limit(1);
        if (existing?.requestHash === requestHash) {
          return c.json(response(existing, undefined, { idempotent: true }));
        }
      }
      const raced = await findBlockingDeliveries(
        targets.map((target) => target.id),
        new Date(),
      );
      if (raced.length > 0) {
        return c.json(
          {
            ok: false,
            error: "A Live Activity is already active on a target device",
            code: "ACTIVE_ACTIVITY_CONFLICT",
          },
          409,
        );
      }
      const racedKeyed = parsed.data.key
        ? await liveKeyedActivity({ requesterServiceId: service.id }, parsed.data.key)
        : undefined;
      if (racedKeyed) {
        return c.json(
          {
            ok: false,
            error: "A Live Activity with this key is still active",
            code: "ACTIVE_ACTIVITY_CONFLICT",
            activityId: racedKeyed.id,
          },
          409,
        );
      }
      throw error;
    }

    const result = await dispatchLiveActivity(
      created.row,
      created.deliveries,
      operationId,
      "start",
      { requesterServiceId: service.id },
    );
    const status = result.accepted === 0 ? "failed" : result.failed > 0 ? "partial" : "active";
    const [row] = await db
      .update(liveActivity)
      .set({ status, acceptedCount: result.accepted, failedCount: result.failed, updatedAt: now })
      .where(and(eq(liveActivity.id, activityId), eq(liveActivity.sequence, 0)))
      .returning();
    await db
      .update(liveActivityOperation)
      .set({ acceptedCount: result.accepted, failedCount: result.failed })
      .where(eq(liveActivityOperation.id, operationId));
    trackActivityOutcome(
      "live_activity_started",
      service.userId,
      created.deliveries.length,
      result,
      service.id,
    );
    if (result.accepted > 0) await trackNotification(service.userId, operationId);
    return c.json(
      response(row ?? created.row, result, {
        ...(parsed.data.replace ? { replaced } : {}),
        ...(result.accepted === 0
          ? { message: "No Live Activity-capable iOS devices accepted the request." }
          : {}),
      }),
      201,
    );
  })
  .get("/:token/live-activities/:identifier", async (c) => {
    const authenticated = await authenticate(c.req.param("token"));
    if (!authenticated) return c.json({ ok: false, error: "Unknown webhook" }, 404);
    const row = await ownedActivity(authenticated.service.id, c.req.param("identifier"));
    if (!row) return c.json({ ok: false, error: "Live Activity not found" }, 404);
    return c.json(response(row));
  })
  .patch("/:token/live-activities/:identifier", async (c) => {
    const authenticated = await authenticate(c.req.param("token"));
    if (!authenticated) return c.json({ ok: false, error: "Unknown webhook" }, 404);
    const { service, owner } = authenticated;
    const parsed = liveActivityUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Invalid Live Activity update", issues: parsed.error.issues },
        400,
      );
    }
    const key = idempotencyKey(c.req.header("Idempotency-Key"));
    if (key === null) return c.json({ ok: false, error: "Invalid Idempotency-Key" }, 400);
    const requestHash = hash({ activity: c.req.param("identifier"), ...parsed.data });
    const replay = await operationReplay(service.id, key, requestHash);
    if (replay?.conflict) {
      return c.json(
        { ok: false, error: "Idempotency-Key was already used with a different payload" },
        409,
      );
    }
    if (replay && !replay.conflict) {
      return c.json(
        response(
          replay.row,
          {
            accepted: replay.operation.acceptedCount,
            failed: replay.operation.failedCount,
            errors: [],
          },
          { idempotent: true },
        ),
      );
    }
    const current = await ownedActivity(service.id, c.req.param("identifier"));
    if (!current) return c.json({ ok: false, error: "Live Activity not found" }, 404);
    if (!["starting", "active", "partial"].includes(current.status)) {
      return c.json({ ok: false, error: "Live Activity is already terminal" }, 409);
    }
    if (parsed.data.ifSequence !== undefined && parsed.data.ifSequence !== current.sequence) {
      return c.json({ ...response(current), ok: false, error: "Sequence conflict" }, 409);
    }
    const limited = await enforceRateLimit(service, owner);
    if (limited) {
      c.header("Retry-After", "60");
      return c.json({ ok: false, ...limited }, 429);
    }
    if (!(await checkNotificationAllowance(service.userId))) {
      return c.json({ ok: false, error: "Monthly notification limit reached" }, 429);
    }
    const now = new Date();
    const previous = liveActivityPropsSchema.parse(current.props);
    const nextProps: Record<string, unknown> = {
      ...previous,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.detail !== null && parsed.data.detail !== undefined
        ? { detail: parsed.data.detail }
        : {}),
      ...(parsed.data.progress !== null && parsed.data.progress !== undefined
        ? { progress: parsed.data.progress }
        : {}),
      ...(parsed.data.symbol !== undefined ? { symbol: parsed.data.symbol } : {}),
      ...(parsed.data.privacyMode !== undefined ? { privacyMode: parsed.data.privacyMode } : {}),
      ...(parsed.data.accentColor !== undefined ? { accentColor: parsed.data.accentColor } : {}),
      updatedAt: now.toISOString(),
    };
    if (parsed.data.detail === null) delete nextProps.detail;
    if (parsed.data.progress === null) delete nextProps.progress;
    const props = liveActivityPropsSchema.parse(nextProps);
    const staleAfterSeconds =
      parsed.data.staleAfterSeconds ??
      (current.staleAt
        ? Math.max(0, Math.round((current.staleAt.getTime() - current.updatedAt.getTime()) / 1000))
        : LIVE_ACTIVITY_DEFAULT_STALE_AFTER_SECONDS);
    const staleAt = new Date(
      Math.min(now.getTime() + staleAfterSeconds * 1000, current.expiresAt.getTime()),
    );
    const operationId = newId("lao");
    let row: ActivityRow | undefined;
    try {
      row = db.transaction((tx) => {
        const updated = tx
          .update(liveActivity)
          .set({
            props,
            sequence: current.sequence + 1,
            apnsTimestamp: Math.max(Math.floor(now.getTime() / 1000), current.apnsTimestamp + 1),
            staleAt,
            updatedAt: now,
          })
          .where(
            and(
              eq(liveActivity.id, current.id),
              eq(liveActivity.sequence, current.sequence),
              inArray(liveActivity.status, ["starting", "active", "partial"]),
            ),
          )
          .returning()
          .get();
        if (!updated) return undefined;
        tx.insert(liveActivityOperation)
          .values({
            id: operationId,
            activityId: updated.id,
            requesterServiceId: service.id,
            event: "update",
            sequence: updated.sequence,
            idempotencyKey: key ?? null,
            requestHash: key ? requestHash : null,
            createdAt: now,
          })
          .run();
        return updated;
      });
    } catch (error) {
      const raced = await operationReplay(service.id, key, requestHash);
      if (raced?.conflict) {
        return c.json(
          { ok: false, error: "Idempotency-Key was already used with a different payload" },
          409,
        );
      }
      if (raced && !raced.conflict) {
        return c.json(
          response(
            raced.row,
            {
              accepted: raced.operation.acceptedCount,
              failed: raced.operation.failedCount,
              errors: [],
            },
            { idempotent: true },
          ),
        );
      }
      throw error;
    }
    if (!row) return c.json({ ok: false, error: "Sequence conflict" }, 409);
    const deliveries = await deliveriesFor(row.id);
    const result = await dispatchLiveActivity(row, deliveries, operationId, "update", {
      requesterServiceId: service.id,
    });
    trackActivityOutcome(
      "live_activity_updated",
      service.userId,
      deliveries.length,
      result,
      service.id,
    );
    const retryable = deliveries.some((delivery) =>
      ["pending", "accepted", "active"].includes(delivery.status),
    );
    const [updated] = await db
      .update(liveActivity)
      .set({
        status:
          result.accepted === 0
            ? retryable
              ? row.status
              : "failed"
            : result.failed > 0
              ? "partial"
              : "active",
        acceptedCount: result.accepted,
        failedCount: result.failed,
      })
      .where(and(eq(liveActivity.id, row.id), eq(liveActivity.sequence, row.sequence)))
      .returning();
    await db
      .update(liveActivityOperation)
      .set({ acceptedCount: result.accepted, failedCount: result.failed })
      .where(eq(liveActivityOperation.id, operationId));
    if (result.accepted > 0) await trackNotification(service.userId, operationId);
    return c.json(response(updated ?? row, result));
  })
  .post("/:token/live-activities/:identifier/end", async (c) => {
    const authenticated = await authenticate(c.req.param("token"));
    if (!authenticated) return c.json({ ok: false, error: "Unknown webhook" }, 404);
    const { service, owner } = authenticated;
    const parsed = liveActivityEndSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Invalid Live Activity end", issues: parsed.error.issues },
        400,
      );
    }
    const key = idempotencyKey(c.req.header("Idempotency-Key"));
    if (key === null) return c.json({ ok: false, error: "Invalid Idempotency-Key" }, 400);
    const requestHash = hash({ activity: c.req.param("identifier"), ...parsed.data });
    const replay = await operationReplay(service.id, key, requestHash);
    if (replay?.conflict) {
      return c.json(
        { ok: false, error: "Idempotency-Key was already used with a different payload" },
        409,
      );
    }
    if (replay && !replay.conflict) {
      return c.json(
        response(
          replay.row,
          {
            accepted: replay.operation.acceptedCount,
            failed: replay.operation.failedCount,
            errors: [],
          },
          { idempotent: true },
        ),
      );
    }
    const current = await ownedActivity(service.id, c.req.param("identifier"));
    if (!current) return c.json({ ok: false, error: "Live Activity not found" }, 404);
    if (!["starting", "active", "partial"].includes(current.status)) {
      return c.json({ ok: false, error: "Live Activity is already terminal" }, 409);
    }
    if (parsed.data.ifSequence !== undefined && parsed.data.ifSequence !== current.sequence) {
      return c.json({ ...response(current), ok: false, error: "Sequence conflict" }, 409);
    }
    const limited = await enforceRateLimit(service, owner);
    if (limited) {
      c.header("Retry-After", "60");
      return c.json({ ok: false, ...limited }, 429);
    }
    const now = new Date();
    const previous = liveActivityPropsSchema.parse(current.props);
    const nextProps: Record<string, unknown> = {
      ...previous,
      status: parsed.data.status,
      symbol: parsed.data.symbol,
      ...(parsed.data.accentColor !== undefined ? { accentColor: parsed.data.accentColor } : {}),
      ...(parsed.data.detail !== null && parsed.data.detail !== undefined
        ? { detail: parsed.data.detail }
        : {}),
      ...(parsed.data.progress !== null && parsed.data.progress !== undefined
        ? { progress: parsed.data.progress }
        : {}),
      updatedAt: now.toISOString(),
    };
    if (parsed.data.detail === null) delete nextProps.detail;
    if (parsed.data.progress === null) delete nextProps.progress;
    const props = liveActivityPropsSchema.parse(nextProps);
    const operationId = newId("lao");
    const dismissalAt = new Date(now.getTime() + parsed.data.dismissAfterSeconds * 1000);
    let row: ActivityRow | undefined;
    try {
      row = db.transaction((tx) => {
        const updated = tx
          .update(liveActivity)
          .set({
            props,
            status: "ended",
            sequence: current.sequence + 1,
            apnsTimestamp: Math.max(Math.floor(now.getTime() / 1000), current.apnsTimestamp + 1),
            dismissalAt,
            updatedAt: now,
            endedAt: now,
          })
          .where(
            and(
              eq(liveActivity.id, current.id),
              eq(liveActivity.sequence, current.sequence),
              inArray(liveActivity.status, ["starting", "active", "partial"]),
            ),
          )
          .returning()
          .get();
        if (!updated) return undefined;
        tx.insert(liveActivityOperation)
          .values({
            id: operationId,
            activityId: updated.id,
            requesterServiceId: service.id,
            event: "end",
            sequence: updated.sequence,
            idempotencyKey: key ?? null,
            requestHash: key ? requestHash : null,
            createdAt: now,
          })
          .run();
        return updated;
      });
    } catch (error) {
      const raced = await operationReplay(service.id, key, requestHash);
      if (raced?.conflict) {
        return c.json(
          { ok: false, error: "Idempotency-Key was already used with a different payload" },
          409,
        );
      }
      if (raced && !raced.conflict) {
        return c.json(
          response(
            raced.row,
            {
              accepted: raced.operation.acceptedCount,
              failed: raced.operation.failedCount,
              errors: [],
            },
            { idempotent: true },
          ),
        );
      }
      throw error;
    }
    if (!row) return c.json({ ok: false, error: "Sequence conflict" }, 409);
    const deliveries = await deliveriesFor(row.id);
    const result = await dispatchLiveActivity(row, deliveries, operationId, "end", {
      requesterServiceId: service.id,
    });
    trackActivityOutcome(
      "live_activity_ended",
      service.userId,
      deliveries.length,
      result,
      service.id,
    );
    const [updated] = await db
      .update(liveActivity)
      .set({ acceptedCount: result.accepted, failedCount: result.failed })
      .where(eq(liveActivity.id, row.id))
      .returning();
    await db
      .update(liveActivityOperation)
      .set({ acceptedCount: result.accepted, failedCount: result.failed })
      .where(eq(liveActivityOperation.id, operationId));
    if (result.accepted > 0) await trackNotification(service.userId, operationId);
    return c.json(response(updated ?? row, result));
  });

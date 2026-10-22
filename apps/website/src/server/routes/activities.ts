import { createHash } from "node:crypto";
import {
  type BillingDto,
  type InteractiveLiveActivityStyle,
  LIVE_ACTIVITY_DEFAULT_STALE_AFTER_SECONDS,
  LIVE_ACTIVITY_SCHEMA_VERSION,
  type LiveActivityDto,
  type LiveActivityMutationResponse,
  type LiveActivityProps,
  type LiveActivityStatus,
  liveActivityEndSchema,
  liveActivityPropsSchema,
  liveActivityStartSchema,
  liveActivityUpdateSchema,
} from "@hark/contracts";
import { and, count, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
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
  liveActivityDeliveryAttempt,
  liveActivityOperation,
  service,
  user as userTable,
} from "../db/schema";
import { env } from "../env";
import { type AnalyticsEventName, failureBucket, track } from "../lib/analytics";
import {
  isInvalidApnsTokenReason,
  type LiveActivityApnsEvent,
  sendLiveActivityPush,
} from "../lib/apns";
import { checkNotificationAllowance, getBilling, trackNotification } from "../lib/billing";
import { newId } from "../lib/id";
import { createLiveActivityInteractionCredential } from "../lib/live-activity-interaction";
import { createLiveActivityRegistrationToken } from "../lib/live-activity-registration";
import { decryptLiveActivityToken } from "../lib/token";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";

export type ActivityRow = typeof liveActivity.$inferSelect;
export type DeliveryRow = typeof liveActivityDelivery.$inferSelect;
export type ActivityRequester =
  | { requesterTokenId: string; requesterServiceId?: never }
  | { requesterTokenId?: never; requesterServiceId: string };

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function idempotencyKey(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 200 ? normalized : null;
}

export function toLiveActivityDto(row: ActivityRow): LiveActivityDto {
  return {
    id: row.id,
    key: row.key,
    props: liveActivityPropsSchema.parse(row.props),
    status: row.status as LiveActivityStatus,
    sequence: row.sequence,
    accepted: row.acceptedCount,
    failed: row.failedCount,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

export async function expireLiveActivity(row: ActivityRow): Promise<ActivityRow> {
  if (!["starting", "active", "partial"].includes(row.status) || row.expiresAt > new Date()) {
    return row;
  }
  const now = new Date();
  const [updated] = await db
    .update(liveActivity)
    .set({ status: "expired", endedAt: now, updatedAt: now })
    .where(
      and(
        eq(liveActivity.id, row.id),
        inArray(liveActivity.status, ["starting", "active", "partial"]),
        lte(liveActivity.expiresAt, now),
      ),
    )
    .returning();
  return updated ?? row;
}

async function ownedActivity(
  tokenId: string,
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
        eq(liveActivity.requesterTokenId, tokenId),
        or(eq(liveActivity.id, identifier), eq(liveActivity.key, identifier)),
        isNull(liveActivity.interactionId),
      ),
    )
    .orderBy(
      desc(inArray(liveActivity.status, ["starting", "active", "partial"])),
      desc(liveActivity.createdAt),
    )
    .limit(1);
  return row ? expireLiveActivity(row) : undefined;
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AgentRateLimit = { error: string; retryAfterSeconds: 60 };

/**
 * Shared per-minute budget for the whole agent surface: Live Activity
 * operations, interactions, and one-shot agent notifications count against
 * the same per-token and per-account windows, mirroring how webhook events
 * share the service and account counters. Synchronous, so callers run it in
 * the same `db.transaction` as the insert it guards: no other request can
 * insert between the count and that insert.
 */
export function agentRateLimited(
  tx: Tx,
  token: AgentEnv["Variables"]["apiToken"],
  billing: BillingDto,
): AgentRateLimit | null {
  const since = new Date(Date.now() - 60_000);
  const value = (row: { value: number } | undefined) => row?.value ?? 0;
  const tokenUsage =
    value(
      tx
        .select({ value: count() })
        .from(liveActivityOperation)
        .innerJoin(liveActivity, eq(liveActivity.id, liveActivityOperation.activityId))
        .where(
          and(
            eq(liveActivityOperation.requesterTokenId, token.id),
            gte(liveActivityOperation.createdAt, since),
            isNull(liveActivity.interactionId),
          ),
        )
        .get(),
    ) +
    value(
      tx
        .select({ value: count() })
        .from(interaction)
        .where(and(eq(interaction.requesterTokenId, token.id), gte(interaction.createdAt, since)))
        .get(),
    ) +
    value(
      tx
        .select({ value: count() })
        .from(agentNotification)
        .where(
          and(
            eq(agentNotification.requesterTokenId, token.id),
            gte(agentNotification.createdAt, since),
          ),
        )
        .get(),
    );
  if (tokenUsage >= billing.limits.servicePerMinute) {
    return { error: "Requester rate limit exceeded", retryAfterSeconds: 60 };
  }
  const accountUsage =
    value(
      tx
        .select({ value: count() })
        .from(liveActivityOperation)
        .innerJoin(liveActivity, eq(liveActivity.id, liveActivityOperation.activityId))
        .where(
          and(
            eq(liveActivity.userId, token.userId),
            gte(liveActivityOperation.createdAt, since),
            isNull(liveActivity.interactionId),
          ),
        )
        .get(),
    ) +
    value(
      tx
        .select({ value: count() })
        .from(interaction)
        .where(and(eq(interaction.userId, token.userId), gte(interaction.createdAt, since)))
        .get(),
    ) +
    value(
      tx
        .select({ value: count() })
        .from(agentNotification)
        .where(
          and(eq(agentNotification.userId, token.userId), gte(agentNotification.createdAt, since)),
        )
        .get(),
    ) +
    value(
      tx
        .select({ value: count() })
        .from(event)
        .innerJoin(service, eq(event.serviceId, service.id))
        .where(and(eq(service.userId, token.userId), gte(event.createdAt, since)))
        .get(),
    );
  if (accountUsage >= billing.limits.accountPerMinute) {
    return { error: "Account rate limit exceeded", retryAfterSeconds: 60 };
  }
  return null;
}

async function recordDelivery(
  operationId: string,
  requester: ActivityRequester,
  activityId: string,
  delivery: DeliveryRow,
  eventName: LiveActivityApnsEvent,
  sequence: number,
  result: Awaited<ReturnType<typeof sendLiveActivityPush>>,
): Promise<void> {
  const now = new Date();
  const invalid = isInvalidApnsTokenReason(result.reason);
  db.transaction((tx) => {
    tx.insert(liveActivityDeliveryAttempt)
      .values({
        id: newId("laa"),
        activityId,
        deliveryId: delivery.id,
        operationId,
        ...requester,
        event: eventName,
        sequence,
        apnsStatus: result.status || null,
        apnsReason: result.reason,
        apnsId: result.apnsId,
        createdAt: now,
      })
      .run();
    tx.update(liveActivityDelivery)
      .set({
        status:
          eventName === "end"
            ? "ended"
            : result.accepted
              ? "accepted"
              : eventName === "start"
                ? "failed"
                : delivery.status,
        lastEvent: eventName,
        lastSequence: sequence,
        lastApnsStatus: result.status || null,
        lastApnsReason: result.reason,
        lastApnsId: result.apnsId,
        lastAttemptAt: now,
        updatedAt: now,
        endedAt: eventName === "end" ? now : null,
        ...(invalid ? { updateTokenCiphertext: null, updateTokenUpdatedAt: null } : {}),
      })
      .where(eq(liveActivityDelivery.id, delivery.id))
      .run();
    if (invalid && eventName === "start") {
      tx.update(device)
        .set({
          liveActivityPushToStartTokenCiphertext: null,
          liveActivityTokenEnvironment: null,
          liveActivitySchemaVersion: null,
          liveActivityTokenUpdatedAt: null,
        })
        .where(eq(device.id, delivery.deviceId))
        .run();
    }
  });
}

async function sendDeliveryEvent(
  row: ActivityRow,
  delivery: DeliveryRow,
  eventName: LiveActivityApnsEvent,
): Promise<Awaited<ReturnType<typeof sendLiveActivityPush>>> {
  const props = liveActivityPropsSchema.parse(row.props);
  const linkedInteraction = props.interaction
    ? await db
        .select()
        .from(interaction)
        .where(eq(interaction.id, props.interaction.id))
        .limit(1)
        .then((rows) => rows[0])
    : undefined;
  if (
    eventName === "start" &&
    linkedInteraction &&
    (linkedInteraction.status !== "pending" || linkedInteraction.expiresAt <= new Date())
  ) {
    return {
      status: 0,
      apnsId: null,
      reason: "InteractionTerminal",
      accepted: false,
    };
  }
  let encryptedToken: string | null;
  if (eventName === "start") {
    const [target] = await db
      .select({ token: device.liveActivityPushToStartTokenCiphertext })
      .from(device)
      .where(eq(device.id, delivery.deviceId))
      .limit(1);
    encryptedToken = target?.token ?? null;
  } else {
    encryptedToken = delivery.updateTokenCiphertext;
  }
  if (!encryptedToken) {
    return {
      status: 0,
      apnsId: null,
      reason: eventName === "start" ? "MissingPushToStartToken" : "MissingUpdateToken",
      accepted: false,
    };
  }
  try {
    return await sendLiveActivityPush(
      decryptLiveActivityToken(encryptedToken),
      delivery.environment as "sandbox" | "production",
      {
        event: eventName,
        props,
        timestamp: row.apnsTimestamp,
        ...(eventName === "start"
          ? {
              attributes: {
                tokenRegistrationURL: `${env.APP_URL.replace(/\/$/, "")}/api/live-activity/update-token`,
                tokenRegistrationToken: createLiveActivityRegistrationToken(
                  delivery.id,
                  row.id,
                  row.expiresAt,
                ),
                deliveryId: delivery.id,
                ...(linkedInteraction
                  ? {
                      harkInteractionId: linkedInteraction.id,
                      harkInteractionCredential: createLiveActivityInteractionCredential({
                        interactionId: linkedInteraction.id,
                        deliveryId: delivery.id,
                        deviceId: delivery.deviceId,
                        actionDigest: linkedInteraction.actionDigest,
                        expiresAt: linkedInteraction.expiresAt,
                      }),
                      harkInteractionDeviceId: delivery.deviceId,
                    }
                  : {}),
              },
            }
          : {}),
        ...(row.staleAt ? { staleDate: Math.floor(row.staleAt.getTime() / 1000) } : {}),
        ...(row.dismissalAt ? { dismissalDate: Math.floor(row.dismissalAt.getTime() / 1000) } : {}),
      },
      10,
    );
  } catch (error) {
    return {
      status: 0,
      apnsId: null,
      reason: error instanceof Error ? error.message : "DeliveryFailed",
      accepted: false,
    };
  }
}

export async function dispatchLiveActivity(
  row: ActivityRow,
  deliveries: DeliveryRow[],
  operationId: string,
  eventName: LiveActivityApnsEvent,
  requester: ActivityRequester,
): Promise<{ accepted: number; failed: number; errors: string[] }> {
  const results = await Promise.all(
    deliveries.map(async (delivery) => {
      const result = await sendDeliveryEvent(row, delivery, eventName);
      await recordDelivery(
        operationId,
        requester,
        row.id,
        delivery,
        eventName,
        row.sequence,
        result,
      );
      return result;
    }),
  );
  return {
    accepted: results.filter((result) => result.accepted).length,
    failed: results.filter((result) => !result.accepted).length,
    errors: [...new Set(results.flatMap((result) => (result.reason ? [result.reason] : [])))],
  };
}

type InteractionRow = typeof interaction.$inferSelect;
type DeviceRow = typeof device.$inferSelect;

export async function startInteractionLiveActivity(
  interactionRow: InteractionRow,
  targets: DeviceRow[],
  style: InteractiveLiveActivityStyle = "approval",
): Promise<{ activityId: string | null; accepted: number; failed: number; errors: string[] }> {
  const capableTargets = targets.filter(
    (target) =>
      target.liveActivityInteractionVersion === 1 &&
      target.liveActivityPushToStartTokenCiphertext &&
      target.liveActivitySchemaVersion === LIVE_ACTIVITY_SCHEMA_VERSION &&
      (target.liveActivityTokenEnvironment === "sandbox" ||
        target.liveActivityTokenEnvironment === "production"),
  );
  if (capableTargets.length === 0) {
    return { activityId: null, accepted: 0, failed: 0, errors: [] };
  }

  const now = new Date();
  const activityId = newId("act");
  const operationId = newId("lao");
  const approval = interactionRow.kind === "approval";
  const interactionKind = approval ? "approval" : "yes_no";
  const props = liveActivityPropsSchema.parse({
    schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
    activityId,
    title: interactionRow.title,
    status: "Approval needed",
    detail: interactionRow.prompt,
    updatedAt: now.toISOString(),
    symbol: "warning",
    privacyMode: "standard",
    accentColor: "#5ED8B7",
    style,
    interaction: {
      id: interactionRow.id,
      kind: interactionKind,
      prompt: interactionRow.prompt,
      primaryLabel: interactionRow.primaryLabel ?? (approval ? "Approve" : "Yes"),
      secondaryLabel: interactionRow.secondaryLabel ?? (approval ? "Deny" : "No"),
      primaryAction: approval ? "approve" : "yes",
      secondaryAction: approval ? "deny" : "no",
      state: "pending",
    },
  } satisfies LiveActivityProps);

  const created = db.transaction((tx) => {
    const activityRow = tx
      .insert(liveActivity)
      .values({
        id: activityId,
        userId: interactionRow.userId,
        requesterTokenId: interactionRow.requesterTokenId,
        requesterServiceId: interactionRow.requesterServiceId,
        interactionId: interactionRow.id,
        schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
        props,
        status: "starting",
        sequence: 0,
        apnsTimestamp: Math.floor(now.getTime() / 1000),
        expiresAt: interactionRow.expiresAt,
        staleAt: interactionRow.expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    tx.insert(liveActivityOperation)
      .values({
        id: operationId,
        activityId,
        requesterTokenId: interactionRow.requesterTokenId,
        requesterServiceId: interactionRow.requesterServiceId,
        event: "start",
        sequence: 0,
        props,
        createdAt: now,
      })
      .run();
    const deliveries = capableTargets.map((target) =>
      tx
        .insert(liveActivityDelivery)
        .values({
          id: newId("lad"),
          activityId,
          deviceId: target.id,
          purpose: "interaction",
          status: "pending",
          environment: target.liveActivityTokenEnvironment as "sandbox" | "production",
          schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );
    return { activityRow, deliveries };
  });

  const requester: ActivityRequester = interactionRow.requesterTokenId
    ? { requesterTokenId: interactionRow.requesterTokenId }
    : { requesterServiceId: interactionRow.requesterServiceId as string };
  const result = await dispatchLiveActivity(
    created.activityRow,
    created.deliveries,
    operationId,
    "start",
    requester,
  );
  const status = result.accepted === 0 ? "failed" : result.failed > 0 ? "partial" : "active";
  await Promise.all([
    db
      .update(liveActivity)
      .set({ status, acceptedCount: result.accepted, failedCount: result.failed })
      .where(eq(liveActivity.id, activityId)),
    db
      .update(liveActivityOperation)
      .set({ acceptedCount: result.accepted, failedCount: result.failed })
      .where(eq(liveActivityOperation.id, operationId)),
  ]);
  return { activityId, ...result };
}

function interactionOutcome(status: string): { title: string; detail: string } {
  if (status === "approved" || status === "yes") {
    return { title: status === "approved" ? "Approved" : "Yes", detail: "Sent to the agent." };
  }
  if (status === "denied" || status === "no") {
    return { title: status === "denied" ? "Denied" : "No", detail: "Sent to the agent." };
  }
  if (status === "expired") return { title: "Expired", detail: "No response was sent." };
  return { title: "Canceled", detail: "This request was canceled." };
}

export async function resolveInteractionLiveActivity(
  interactionRow: InteractionRow,
): Promise<void> {
  const [current] = await db
    .select()
    .from(liveActivity)
    .where(eq(liveActivity.interactionId, interactionRow.id))
    .limit(1);
  if (!current || !["starting", "active", "partial"].includes(current.status)) return;

  const now = new Date();
  const currentProps = liveActivityPropsSchema.parse(current.props);
  if (!currentProps.interaction) return;
  const outcome = interactionOutcome(interactionRow.status);
  const props = liveActivityPropsSchema.parse({
    ...currentProps,
    status: outcome.title,
    detail: outcome.detail,
    symbol:
      interactionRow.status === "approved" || interactionRow.status === "yes"
        ? "success"
        : "warning",
    updatedAt: now.toISOString(),
    interaction: { ...currentProps.interaction, state: interactionRow.status },
  });
  const operationId = newId("lao");
  const updated = db.transaction((tx) => {
    const row = tx
      .update(liveActivity)
      .set({
        props,
        status: "ended",
        sequence: current.sequence + 1,
        apnsTimestamp: Math.max(Math.floor(now.getTime() / 1000), current.apnsTimestamp + 1),
        dismissalAt: new Date(now.getTime() + 30_000),
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
    if (!row) return undefined;
    tx.insert(liveActivityOperation)
      .values({
        id: operationId,
        activityId: row.id,
        requesterTokenId: row.requesterTokenId,
        requesterServiceId: row.requesterServiceId,
        event: "end",
        sequence: row.sequence,
        props,
        createdAt: now,
      })
      .run();
    return row;
  });
  if (!updated) return;

  const deliveries = await db
    .select()
    .from(liveActivityDelivery)
    .where(
      and(
        eq(liveActivityDelivery.activityId, updated.id),
        inArray(liveActivityDelivery.status, ["pending", "accepted", "active"]),
      ),
    );
  const requester: ActivityRequester = updated.requesterTokenId
    ? { requesterTokenId: updated.requesterTokenId }
    : { requesterServiceId: updated.requesterServiceId as string };
  const result = await dispatchLiveActivity(updated, deliveries, operationId, "end", requester);
  await db
    .update(liveActivityOperation)
    .set({ acceptedCount: result.accepted, failedCount: result.failed })
    .where(eq(liveActivityOperation.id, operationId));
}

export type BlockingDelivery = { activity: ActivityRow; delivery: DeliveryRow };

/**
 * Returns the live deliveries occupying any of the given devices, joined with
 * their activities. Deliveries belonging to expired or terminal activities are
 * lazily marked ended instead of being reported as blockers.
 */
export async function findBlockingDeliveries(
  deviceIds: string[],
  now: Date,
): Promise<BlockingDelivery[]> {
  if (deviceIds.length === 0) return [];
  const occupied = await db
    .select({ delivery: liveActivityDelivery, activity: liveActivity })
    .from(liveActivityDelivery)
    .innerJoin(liveActivity, eq(liveActivity.id, liveActivityDelivery.activityId))
    .where(
      and(
        inArray(liveActivityDelivery.deviceId, deviceIds),
        inArray(liveActivityDelivery.status, ["pending", "accepted", "active"]),
        isNull(liveActivity.interactionId),
      ),
    );
  const live = (item: BlockingDelivery) =>
    item.activity.expiresAt > now &&
    ["starting", "active", "partial"].includes(item.activity.status);
  const expired = occupied.filter((item) => !live(item)).map((item) => item.delivery.id);
  if (expired.length > 0) {
    await db
      .update(liveActivityDelivery)
      .set({ status: "ended", endedAt: now, updatedAt: now })
      .where(inArray(liveActivityDelivery.id, expired));
  }
  return occupied.filter(live);
}

/**
 * Implicitly ends the blocking deliveries so a `replace: true` start can take
 * the device slot: each blocked device receives a silent end push with the
 * blocking activity's current state and immediate dismissal, the deliveries
 * are marked ended, and a blocking activity with no remaining live deliveries
 * becomes terminal. These ends are intentionally unmetered and create no
 * liveActivityOperation rows; only the surrounding start is billed.
 * Returns the number of distinct blocking activities affected.
 */
export async function replaceBlockingDeliveries(
  blockers: BlockingDelivery[],
  now: Date,
  alsoEnd?: ActivityRow,
): Promise<number> {
  const byActivity = new Map<string, { activity: ActivityRow; deliveries: DeliveryRow[] }>();
  const seenDeliveries = new Set<string>();
  const add = (activity: ActivityRow, delivery?: DeliveryRow) => {
    const group = byActivity.get(activity.id) ?? { activity, deliveries: [] };
    byActivity.set(activity.id, group);
    if (delivery && !seenDeliveries.has(delivery.id)) {
      seenDeliveries.add(delivery.id);
      group.deliveries.push(delivery);
    }
  };
  for (const { activity, delivery } of blockers) add(activity, delivery);
  if (alsoEnd) {
    // Taking over a key ends the keyed activity everywhere: its live
    // deliveries on devices outside this start's targets are ended too, so
    // the key cannot stay held by a half-alive run.
    add(alsoEnd);
    const keyedDeliveries = await db
      .select()
      .from(liveActivityDelivery)
      .where(
        and(
          eq(liveActivityDelivery.activityId, alsoEnd.id),
          inArray(liveActivityDelivery.status, ["pending", "accepted", "active"]),
        ),
      );
    for (const delivery of keyedDeliveries) add(alsoEnd, delivery);
  }
  for (const { activity, deliveries } of byActivity.values()) {
    const ending: ActivityRow = {
      ...activity,
      sequence: activity.sequence + 1,
      apnsTimestamp: Math.max(Math.floor(now.getTime() / 1000), activity.apnsTimestamp + 1),
      dismissalAt: now,
    };
    await Promise.all(
      deliveries.map(async (delivery) => {
        const result = await sendDeliveryEvent(ending, delivery, "end");
        // The delivery is released even when the push fails, matching how a
        // rejected explicit end still frees the device. The update token is
        // cleared so later operations on a surviving multi-device activity
        // cannot resurrect this delivery.
        await db
          .update(liveActivityDelivery)
          .set({
            status: "ended",
            lastEvent: "end",
            lastSequence: ending.sequence,
            lastApnsStatus: result.status || null,
            lastApnsReason: result.reason,
            lastApnsId: result.apnsId,
            lastAttemptAt: now,
            updatedAt: now,
            endedAt: now,
            updateTokenCiphertext: null,
            updateTokenUpdatedAt: null,
          })
          .where(eq(liveActivityDelivery.id, delivery.id));
      }),
    );
    const [remaining] = await db
      .select({ value: count() })
      .from(liveActivityDelivery)
      .where(
        and(
          eq(liveActivityDelivery.activityId, activity.id),
          inArray(liveActivityDelivery.status, ["pending", "accepted", "active"]),
        ),
      );
    if ((remaining?.value ?? 0) === 0) {
      await db
        .update(liveActivity)
        .set({
          status: "ended",
          sequence: ending.sequence,
          apnsTimestamp: ending.apnsTimestamp,
          dismissalAt: now,
          updatedAt: now,
          endedAt: now,
        })
        .where(
          and(
            eq(liveActivity.id, activity.id),
            eq(liveActivity.sequence, activity.sequence),
            inArray(liveActivity.status, ["starting", "active", "partial"]),
          ),
        );
    }
  }
  return byActivity.size;
}

/**
 * Returns the requester's live activity holding the given key, if any. Stale
 * rows past their expiry are lazily expired first, which also releases the
 * partial unique key index so the key becomes reusable.
 */
export async function liveKeyedActivity(
  requester: ActivityRequester,
  key: string,
): Promise<ActivityRow | undefined> {
  const [row] = await db
    .select()
    .from(liveActivity)
    .where(
      and(
        requester.requesterTokenId !== undefined
          ? eq(liveActivity.requesterTokenId, requester.requesterTokenId)
          : eq(liveActivity.requesterServiceId, requester.requesterServiceId),
        eq(liveActivity.key, key),
        inArray(liveActivity.status, ["starting", "active", "partial"]),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  const fresh = await expireLiveActivity(row);
  return ["starting", "active", "partial"].includes(fresh.status) ? fresh : undefined;
}

/** Records the outcome of one Live Activity operation without touching task content. */
export function trackActivityOutcome(
  name: Extract<
    AnalyticsEventName,
    "live_activity_started" | "live_activity_updated" | "live_activity_ended"
  >,
  userId: string,
  targets: number,
  result: { accepted: number; failed: number; errors: string[] },
  serviceId?: string,
): void {
  const outcome =
    result.accepted > 0
      ? result.failed > 0
        ? "partial"
        : "accepted"
      : targets === 0
        ? "no_devices"
        : failureBucket(result.errors[0]);
  track({
    name,
    userId,
    serviceId,
    outcome,
    value: result.accepted,
    metadata: { failed: result.failed, targets },
  });
  if (result.accepted > 0) {
    track({
      name: "notification_sent",
      userId,
      serviceId,
      outcome: "live_activity",
      value: result.accepted,
    });
    return;
  }
  track({
    name: "live_activity_failed",
    userId,
    serviceId,
    outcome,
    metadata: { event: name.replace("live_activity_", ""), targets },
  });
}

async function operationReplay(
  tokenId: string,
  key: string | undefined,
  requestHash: string,
): Promise<
  | { conflict: true }
  | { conflict: false; operation: typeof liveActivityOperation.$inferSelect; row: ActivityRow }
  | undefined
> {
  if (!key) return undefined;
  const [operation] = await db
    .select()
    .from(liveActivityOperation)
    .where(
      and(
        eq(liveActivityOperation.requesterTokenId, tokenId),
        eq(liveActivityOperation.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (!operation) return undefined;
  if (operation.requestHash !== requestHash) return { conflict: true };
  const [row] = await db
    .select()
    .from(liveActivity)
    .where(eq(liveActivity.id, operation.activityId))
    .limit(1);
  return row ? { conflict: false, operation, row } : undefined;
}

export const activitiesAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/", requireScopes("activities:read"), async (c) => {
    const requested = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 50;
    const rows = await db
      .select()
      .from(liveActivity)
      .where(
        and(
          eq(liveActivity.requesterTokenId, c.get("apiToken").id),
          isNull(liveActivity.interactionId),
        ),
      )
      .orderBy(desc(liveActivity.createdAt))
      .limit(limit);
    return c.json({
      activities: await Promise.all(rows.map(expireLiveActivity)).then((items) =>
        items.map(toLiveActivityDto),
      ),
    });
  })
  .post("/", requireScopes("activities:write"), async (c) => {
    const token = c.get("apiToken");
    const parsed = liveActivityStartSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid Live Activity", issues: parsed.error.issues }, 400);
    }
    const key = idempotencyKey(c.req.header("Idempotency-Key"));
    if (key === null) {
      return c.json({ error: "Idempotency-Key must contain between 1 and 200 characters" }, 400);
    }
    const requestHash = hash(parsed.data);
    if (key) {
      const [existing] = await db
        .select()
        .from(liveActivity)
        .where(
          and(eq(liveActivity.requesterTokenId, token.id), eq(liveActivity.idempotencyKey, key)),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return c.json(
            { error: "Idempotency-Key was already used with a different payload" },
            409,
          );
        }
        return c.json<LiveActivityMutationResponse>({
          activity: toLiveActivityDto(await expireLiveActivity(existing)),
          accepted: existing.acceptedCount,
          failed: existing.failedCount,
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
    if (!(await checkNotificationAllowance(token.userId))) {
      return c.json({ error: "Monthly notification limit reached" }, 429);
    }
    // Early check so a limited start does not replace anything; the insert
    // transaction below re-counts and is what actually holds the limit.
    const limited = db.transaction((tx) => agentRateLimited(tx, token, billing));
    if (limited) {
      c.header("Retry-After", "60");
      return c.json(limited, 429);
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
    targets = targets.filter(
      (target) =>
        target.liveActivityPushToStartTokenCiphertext &&
        target.liveActivitySchemaVersion === LIVE_ACTIVITY_SCHEMA_VERSION &&
        (target.liveActivityTokenEnvironment === "sandbox" ||
          target.liveActivityTokenEnvironment === "production"),
    );

    const now = new Date();
    const blockers = await findBlockingDeliveries(
      targets.map((target) => target.id),
      now,
    );
    let replaced = 0;
    const firstBlocker = blockers[0];
    if (firstBlocker && !parsed.data.replace) {
      return c.json(
        {
          error: "A Live Activity is already active on a target device",
          code: "ACTIVE_ACTIVITY_CONFLICT",
          activityId: firstBlocker.activity.id,
        },
        409,
      );
    }
    const keyed = parsed.data.key
      ? await liveKeyedActivity({ requesterTokenId: token.id }, parsed.data.key)
      : undefined;
    if (keyed && !parsed.data.replace) {
      return c.json(
        {
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

    const apnsTimestamp = Math.floor(now.getTime() / 1000);
    const activityId = newId("act");
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
      style: parsed.data.style,
    };
    const values: typeof liveActivity.$inferInsert = {
      id: activityId,
      userId: token.userId,
      requesterTokenId: token.id,
      key: parsed.data.key ?? null,
      schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
      props,
      status: "starting",
      sequence: 0,
      apnsTimestamp,
      idempotencyKey: key ?? null,
      requestHash: key ? requestHash : null,
      expiresAt: new Date(now.getTime() + parsed.data.expiresInSeconds * 1000),
      staleAt: new Date(
        Math.min(
          now.getTime() + parsed.data.staleAfterSeconds * 1000,
          now.getTime() + parsed.data.expiresInSeconds * 1000,
        ),
      ),
      createdAt: now,
      updatedAt: now,
    };
    const operationId = newId("lao");
    let row: ActivityRow | undefined;
    let insertLimited: AgentRateLimit | null;
    try {
      ({ row, limited: insertLimited } = db.transaction((tx) => {
        const limitedNow = agentRateLimited(tx, token, billing);
        if (limitedNow) return { row: undefined, limited: limitedNow };
        const inserted = tx.insert(liveActivity).values(values).returning().get();
        tx.insert(liveActivityOperation)
          .values({
            id: operationId,
            activityId: inserted.id,
            requesterTokenId: token.id,
            event: "start",
            sequence: inserted.sequence,
            props: inserted.props,
            idempotencyKey: key ?? null,
            requestHash: key ? requestHash : null,
            createdAt: now,
          })
          .run();
        return { row: inserted, limited: null };
      }));
    } catch (error) {
      if (key) {
        const [existing] = await db
          .select()
          .from(liveActivity)
          .where(
            and(eq(liveActivity.requesterTokenId, token.id), eq(liveActivity.idempotencyKey, key)),
          )
          .limit(1);
        if (existing?.requestHash === requestHash) {
          return c.json<LiveActivityMutationResponse>({
            activity: toLiveActivityDto(existing),
            accepted: existing.acceptedCount,
            failed: existing.failedCount,
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
      const raced = await findBlockingDeliveries(
        targets.map((target) => target.id),
        new Date(),
      );
      const racedBlocker = raced[0];
      if (racedBlocker) {
        return c.json(
          {
            error: "A Live Activity is already active on a target device",
            code: "ACTIVE_ACTIVITY_CONFLICT",
            activityId: racedBlocker.activity.id,
          },
          409,
        );
      }
      const racedKeyed = parsed.data.key
        ? await liveKeyedActivity({ requesterTokenId: token.id }, parsed.data.key)
        : undefined;
      if (racedKeyed) {
        return c.json(
          {
            error: "A Live Activity with this key is still active",
            code: "ACTIVE_ACTIVITY_CONFLICT",
            activityId: racedKeyed.id,
          },
          409,
        );
      }
      throw error;
    }
    if (insertLimited) {
      c.header("Retry-After", "60");
      return c.json(insertLimited, 429);
    }
    if (!row) return c.json({ error: "Failed to create Live Activity" }, 500);
    const createdActivityId = row.id;
    const deliveries =
      targets.length === 0
        ? []
        : await db
            .insert(liveActivityDelivery)
            .values(
              targets.map((target) => ({
                id: newId("lad"),
                activityId: createdActivityId,
                deviceId: target.id,
                status: "pending",
                environment: target.liveActivityTokenEnvironment as "sandbox" | "production",
                schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
                createdAt: now,
                updatedAt: now,
              })),
            )
            .returning();
    const result = await dispatchLiveActivity(row, deliveries, operationId, "start", {
      requesterTokenId: token.id,
    });
    const status = result.accepted === 0 ? "failed" : result.failed > 0 ? "partial" : "active";
    const [updatedRow] = await db
      .update(liveActivity)
      .set({ status, acceptedCount: result.accepted, failedCount: result.failed, updatedAt: now })
      .where(eq(liveActivity.id, row.id))
      .returning();
    row = updatedRow ?? row;
    await db
      .update(liveActivityOperation)
      .set({ acceptedCount: result.accepted, failedCount: result.failed })
      .where(eq(liveActivityOperation.id, operationId));
    trackActivityOutcome("live_activity_started", token.userId, deliveries.length, result);
    if (result.accepted > 0) await trackNotification(token.userId, operationId);
    return c.json<LiveActivityMutationResponse>(
      {
        activity: toLiveActivityDto(row),
        accepted: result.accepted,
        failed: result.failed,
        ...(parsed.data.replace ? { replaced } : {}),
        ...(result.accepted === 0
          ? {
              message:
                result.errors.join("; ") ||
                "No Live Activity-capable iOS devices are registered for this account.",
            }
          : {}),
      },
      201,
    );
  })
  .get("/:identifier", requireScopes("activities:read"), async (c) => {
    const row = await ownedActivity(c.get("apiToken").id, c.req.param("identifier"));
    if (!row) return c.json({ error: "Live Activity not found" }, 404);
    return c.json({ activity: toLiveActivityDto(row) });
  })
  .patch("/:identifier", requireScopes("activities:write"), async (c) => {
    const token = c.get("apiToken");
    const parsed = liveActivityUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid Live Activity update", issues: parsed.error.issues }, 400);
    }
    const key = idempotencyKey(c.req.header("Idempotency-Key"));
    if (key === null) return c.json({ error: "Invalid Idempotency-Key" }, 400);
    const requestHash = hash({ activity: c.req.param("identifier"), ...parsed.data });
    const replay = await operationReplay(token.id, key, requestHash);
    if (replay?.conflict) {
      return c.json({ error: "Idempotency-Key was already used with a different payload" }, 409);
    }
    if (replay && !replay.conflict) {
      return c.json<LiveActivityMutationResponse>({
        activity: toLiveActivityDto(replay.row),
        accepted: replay.operation.acceptedCount,
        failed: replay.operation.failedCount,
        idempotent: true,
      });
    }
    const current = await ownedActivity(token.id, c.req.param("identifier"));
    if (!current) return c.json({ error: "Live Activity not found" }, 404);
    if (!["starting", "active", "partial"].includes(current.status)) {
      return c.json(
        { error: "Live Activity is already terminal", activity: toLiveActivityDto(current) },
        409,
      );
    }
    if (parsed.data.ifSequence !== undefined && parsed.data.ifSequence !== current.sequence) {
      return c.json({ error: "Sequence conflict", activity: toLiveActivityDto(current) }, 409);
    }
    const [owner] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, token.userId))
      .limit(1);
    if (!owner) return c.json({ error: "Account not found" }, 404);
    const billing = await getBilling(owner, true);
    if (!(await checkNotificationAllowance(token.userId))) {
      return c.json({ error: "Monthly notification limit reached" }, 429);
    }
    const now = new Date();
    const apnsTimestamp = Math.max(Math.floor(now.getTime() / 1000), current.apnsTimestamp + 1);
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
      ...(parsed.data.style !== undefined ? { style: parsed.data.style } : {}),
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
    let limited: AgentRateLimit | null;
    try {
      ({ row, limited } = db.transaction((tx) => {
        const limitedNow = agentRateLimited(tx, token, billing);
        if (limitedNow) return { row: undefined, limited: limitedNow };
        const updated = tx
          .update(liveActivity)
          .set({
            props,
            sequence: current.sequence + 1,
            apnsTimestamp,
            updatedAt: now,
            staleAt,
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
        if (!updated) return { row: undefined, limited: null };
        tx.insert(liveActivityOperation)
          .values({
            id: operationId,
            activityId: updated.id,
            requesterTokenId: token.id,
            event: "update",
            sequence: updated.sequence,
            props,
            idempotencyKey: key ?? null,
            requestHash: key ? requestHash : null,
            createdAt: now,
          })
          .run();
        return { row: updated, limited: null };
      }));
    } catch (error) {
      const raced = await operationReplay(token.id, key, requestHash);
      if (raced?.conflict) {
        return c.json({ error: "Idempotency-Key was already used with a different payload" }, 409);
      }
      if (raced && !raced.conflict) {
        return c.json<LiveActivityMutationResponse>({
          activity: toLiveActivityDto(raced.row),
          accepted: raced.operation.acceptedCount,
          failed: raced.operation.failedCount,
          idempotent: true,
        });
      }
      throw error;
    }
    if (limited) {
      c.header("Retry-After", "60");
      return c.json(limited, 429);
    }
    if (!row) return c.json({ error: "Sequence conflict" }, 409);
    const deliveries = await db
      .select()
      .from(liveActivityDelivery)
      .where(eq(liveActivityDelivery.activityId, row.id));
    const result = await dispatchLiveActivity(row, deliveries, operationId, "update", {
      requesterTokenId: token.id,
    });
    trackActivityOutcome("live_activity_updated", token.userId, deliveries.length, result);
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
      .where(eq(liveActivity.id, row.id))
      .returning();
    await db
      .update(liveActivityOperation)
      .set({ acceptedCount: result.accepted, failedCount: result.failed })
      .where(eq(liveActivityOperation.id, operationId));
    if (result.accepted > 0) await trackNotification(token.userId, operationId);
    return c.json<LiveActivityMutationResponse>({
      activity: toLiveActivityDto(updated ?? row),
      accepted: result.accepted,
      failed: result.failed,
      ...(result.errors.length ? { message: result.errors.join("; ") } : {}),
    });
  })
  .post("/:identifier/end", requireScopes("activities:write"), async (c) => {
    const token = c.get("apiToken");
    const parsed = liveActivityEndSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "Invalid Live Activity end", issues: parsed.error.issues }, 400);
    }
    const key = idempotencyKey(c.req.header("Idempotency-Key"));
    if (key === null) return c.json({ error: "Invalid Idempotency-Key" }, 400);
    const requestHash = hash({ activity: c.req.param("identifier"), ...parsed.data });
    const replay = await operationReplay(token.id, key, requestHash);
    if (replay?.conflict) {
      return c.json({ error: "Idempotency-Key was already used with a different payload" }, 409);
    }
    if (replay && !replay.conflict) {
      return c.json<LiveActivityMutationResponse>({
        activity: toLiveActivityDto(replay.row),
        accepted: replay.operation.acceptedCount,
        failed: replay.operation.failedCount,
        idempotent: true,
      });
    }
    const current = await ownedActivity(token.id, c.req.param("identifier"));
    if (!current) return c.json({ error: "Live Activity not found" }, 404);
    if (!["starting", "active", "partial"].includes(current.status)) {
      return c.json(
        { error: "Live Activity is already terminal", activity: toLiveActivityDto(current) },
        409,
      );
    }
    if (parsed.data.ifSequence !== undefined && parsed.data.ifSequence !== current.sequence) {
      return c.json({ error: "Sequence conflict", activity: toLiveActivityDto(current) }, 409);
    }
    const [owner] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, token.userId))
      .limit(1);
    if (!owner) return c.json({ error: "Account not found" }, 404);
    const billing = await getBilling(owner, true);
    // Ending intentionally bypasses the monthly allowance so an agent can always clear Lock Screen UI.
    const now = new Date();
    const apnsTimestamp = Math.max(Math.floor(now.getTime() / 1000), current.apnsTimestamp + 1);
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
    let row: ActivityRow | undefined;
    let limited: AgentRateLimit | null;
    try {
      ({ row, limited } = db.transaction((tx) => {
        const limitedNow = agentRateLimited(tx, token, billing);
        if (limitedNow) return { row: undefined, limited: limitedNow };
        const updated = tx
          .update(liveActivity)
          .set({
            props,
            status: "ended",
            sequence: current.sequence + 1,
            apnsTimestamp,
            dismissalAt: new Date(now.getTime() + parsed.data.dismissAfterSeconds * 1000),
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
        if (!updated) return { row: undefined, limited: null };
        tx.insert(liveActivityOperation)
          .values({
            id: operationId,
            activityId: updated.id,
            requesterTokenId: token.id,
            event: "end",
            sequence: updated.sequence,
            props,
            idempotencyKey: key ?? null,
            requestHash: key ? requestHash : null,
            createdAt: now,
          })
          .run();
        return { row: updated, limited: null };
      }));
    } catch (error) {
      const raced = await operationReplay(token.id, key, requestHash);
      if (raced?.conflict) {
        return c.json({ error: "Idempotency-Key was already used with a different payload" }, 409);
      }
      if (raced && !raced.conflict) {
        return c.json<LiveActivityMutationResponse>({
          activity: toLiveActivityDto(raced.row),
          accepted: raced.operation.acceptedCount,
          failed: raced.operation.failedCount,
          idempotent: true,
        });
      }
      throw error;
    }
    if (limited) {
      c.header("Retry-After", "60");
      return c.json(limited, 429);
    }
    if (!row) return c.json({ error: "Sequence conflict" }, 409);
    const deliveries = await db
      .select()
      .from(liveActivityDelivery)
      .where(eq(liveActivityDelivery.activityId, row.id));
    const result = await dispatchLiveActivity(row, deliveries, operationId, "end", {
      requesterTokenId: token.id,
    });
    trackActivityOutcome("live_activity_ended", token.userId, deliveries.length, result);
    const [updated] = await db
      .update(liveActivity)
      .set({ acceptedCount: result.accepted, failedCount: result.failed })
      .where(eq(liveActivity.id, row.id))
      .returning();
    await db
      .update(liveActivityOperation)
      .set({ acceptedCount: result.accepted, failedCount: result.failed })
      .where(eq(liveActivityOperation.id, operationId));
    if (result.accepted > 0) await trackNotification(token.userId, operationId);
    return c.json<LiveActivityMutationResponse>({
      activity: toLiveActivityDto(updated ?? row),
      accepted: result.accepted,
      failed: result.failed,
      ...(result.errors.length ? { message: result.errors.join("; ") } : {}),
    });
  });

export const activitiesSessionRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const rows = await db
      .select({
        row: liveActivity,
        tokenName: apiToken.name,
        serviceName: service.title,
        serviceImageUrl: service.imageUrl,
      })
      .from(liveActivity)
      .leftJoin(apiToken, eq(liveActivity.requesterTokenId, apiToken.id))
      .leftJoin(service, eq(liveActivity.requesterServiceId, service.id))
      .where(
        and(
          eq(liveActivity.userId, c.get("user").id),
          inArray(liveActivity.status, ["starting", "active", "partial"]),
          isNull(liveActivity.interactionId),
        ),
      )
      .orderBy(desc(liveActivity.updatedAt))
      .limit(20);
    const activities = await Promise.all(
      rows.map(async ({ row, tokenName, serviceName, serviceImageUrl }) => ({
        ...toLiveActivityDto(await expireLiveActivity(row)),
        sourceName:
          serviceName ??
          tokenName ??
          (typeof row.props.title === "string" ? row.props.title : "Hark"),
        sourceImageUrl: serviceImageUrl,
      })),
    );
    return c.json({
      activities: activities.filter((item) =>
        ["starting", "active", "partial"].includes(item.status),
      ),
    });
  });

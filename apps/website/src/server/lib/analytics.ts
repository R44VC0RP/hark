import { lt, sql } from "drizzle-orm";
import { db } from "../db";
import { analyticsDaily, analyticsEvent, analyticsUserDay } from "../db/schema";
import { newId } from "./id";

/**
 * Self-hosted product analytics.
 *
 * Rules that must hold for every writer in this file:
 * - Writes are synchronous (better-sqlite3) and fire-and-forget: `track()` never
 *   throws, so a failing analytics write can never fail the parent request.
 * - Only identifiers, enum-ish names, coarse buckets and counters are stored.
 *   Notification titles/bodies, prompts, reply text, webhook or push tokens,
 *   emails, IP addresses and user agents must never reach these tables.
 */

/** Every event name accepted from first-party clients or written by the server. */
export const ANALYTICS_EVENT_NAMES = [
  "webhook_received",
  "webhook_delivered",
  "webhook_failed",
  "webhook_rate_limited",
  "webhook_quota_exceeded",
  "device_registered",
  "device_unregistered",
  "device_deactivated_stale",
  "service_created",
  "service_updated",
  "service_token_rotated",
  "service_deleted",
  "user_active",
  "notification_sent",
  "onboarding_welcome_sent",
  "agent_notification_created",
  "interaction_created",
  "interaction_responded",
  "live_activity_started",
  "live_activity_updated",
  "live_activity_ended",
  "live_activity_failed",
  "plan_upgraded",
  "plan_checkout_started",
  "billing_portal_opened",
  "api_token_created",
  "api_token_revoked",
  "cli_authorization_approved",
  "page_view",
  "screen_view",
  "outbound_clicked",
  "auth_started",
  "auth_completed",
  "app_open",
  "notification_opened",
  "notification_permission_prompted",
  "notification_permission_resolved",
  "device_registration_started",
  "device_registration_completed",
  "onboarding_completed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

/** Raw analytics events are pruned after this many days; rollups are kept forever. */
export const ANALYTICS_RETENTION_DAYS = 180;
/** Daily-active rows are cheap and power retention, so they live longer. */
export const ANALYTICS_USER_DAY_RETENTION_DAYS = 400;

const MAX_METADATA_CHARS = 512;
const MAX_METADATA_KEYS = 8;
const MAX_METADATA_STRING_CHARS = 64;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOG_THROTTLE_MS = 60_000;

export interface TrackInput {
  name: AnalyticsEventName;
  clientEventId?: string | null;
  anonymousId?: string | null;
  sessionId?: string | null;
  surface?: "web" | "ios" | "server" | null;
  userId?: string | null;
  serviceId?: string | null;
  deviceId?: string | null;
  plan?: string | null;
  outcome?: string | null;
  /** Counter carried by the event (accepted pushes, deleted devices, ...). */
  value?: number;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

let lastLoggedAt = 0;
let lastPrunedAt = 0;
/** Per-process memo of `${userId}:${day}` pings already written today. */
const activeDayCache = new Set<string>();

function warn(error: unknown): void {
  const now = Date.now();
  if (now - lastLoggedAt < LOG_THROTTLE_MS) return;
  lastLoggedAt = now;
  console.warn("[analytics] Skipped a usage write", error);
}

/** UTC `YYYY-MM-DD`, the key used by every rollup and daily-active row. */
export function analyticsDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** Coarse, non-identifying bucket for a failure reason string. */
export function failureBucket(reason: string | null | undefined): string {
  if (!reason) return "unknown";
  const value = reason.toLowerCase();
  if (value.includes("devicenotregistered") || value.includes("unregistered")) {
    return "device_unregistered";
  }
  if (value.includes("missing") && value.includes("token")) return "missing_token";
  if (
    value.includes("token") &&
    (value.includes("bad") || value.includes("invalid") || value.includes("expired"))
  ) {
    return "invalid_token";
  }
  if (value.includes("toomanyrequests") || value.includes("rate")) return "rate_limited";
  if (value.includes("payloadtoolarge") || value.includes("messagetoobig"))
    return "payload_too_big";
  if (value.includes("timeout") || value.includes("econn") || value.includes("network")) {
    return "network";
  }
  if (value.includes("internalserver") || value.includes("serviceunavailable")) return "upstream";
  return "other";
}

function serializeMetadata(
  metadata: TrackInput["metadata"],
): { ok: true; value: string | null } | { ok: false } {
  if (!metadata) return { ok: true, value: null };
  const safe: Record<string, string | number | boolean> = {};
  let keys = 0;
  for (const [key, raw] of Object.entries(metadata)) {
    if (raw === null || raw === undefined) continue;
    if (keys >= MAX_METADATA_KEYS) break;
    if (typeof raw === "string") {
      safe[key] = raw.slice(0, MAX_METADATA_STRING_CHARS);
    } else if (typeof raw === "number") {
      safe[key] = Number.isFinite(raw) ? raw : 0;
    } else {
      safe[key] = raw;
    }
    keys += 1;
  }
  if (keys === 0) return { ok: true, value: null };
  const encoded = JSON.stringify(safe);
  return { ok: true, value: encoded.length > MAX_METADATA_CHARS ? null : encoded };
}

/** Increments one rollup counter. Idempotent per (day, metric) via upsert. */
function bumpDaily(day: string, metric: string, delta: number, now: Date): void {
  db.insert(analyticsDaily)
    .values({ day, metric, value: delta, updatedAt: now })
    .onConflictDoUpdate({
      target: [analyticsDaily.day, analyticsDaily.metric],
      set: { value: sql`${analyticsDaily.value} + ${delta}`, updatedAt: now },
    })
    .run();
}

/**
 * Records one usage event plus its daily rollups. Never throws.
 *
 * Rollups written per event: `<name>` counts occurrences and `<name>:value`
 * sums the carried counter when it is non-zero.
 */
export function track(input: TrackInput): boolean {
  try {
    const now = new Date();
    const day = analyticsDay(now);
    const value = Number.isFinite(input.value) ? Math.trunc(input.value as number) : 0;
    const metadata = serializeMetadata(input.metadata);
    const inserted = db
      .insert(analyticsEvent)
      .values({
        id: newId("anl"),
        clientEventId: input.clientEventId ?? null,
        name: input.name,
        anonymousId: input.anonymousId ?? null,
        sessionId: input.sessionId ?? null,
        surface: input.surface ?? "server",
        userId: input.userId ?? null,
        serviceId: input.serviceId ?? null,
        deviceId: input.deviceId ?? null,
        plan: input.plan ?? null,
        outcome: input.outcome ?? null,
        value,
        metadata: metadata.ok ? metadata.value : null,
        createdAt: now,
      })
      .onConflictDoNothing({ target: analyticsEvent.clientEventId })
      .run();
    if (inserted.changes === 0) return false;
    bumpDaily(day, input.name, 1, now);
    if (value !== 0) bumpDaily(day, `${input.name}:value`, value, now);
    maybePrune(now);
    return true;
  } catch (error) {
    warn(error);
    return false;
  }
}

/**
 * Daily-active ping. Deduped per user per UTC day, so calling it on every
 * authenticated request costs one cached lookup after the first hit. Never throws.
 */
export function trackUserActive(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    const now = new Date();
    const day = analyticsDay(now);
    const cacheKey = `${userId}:${day}`;
    if (activeDayCache.has(cacheKey)) return;
    if (activeDayCache.size > 10_000) activeDayCache.clear();
    const inserted = db
      .insert(analyticsUserDay)
      .values({ userId, day, createdAt: now })
      .onConflictDoNothing({ target: [analyticsUserDay.userId, analyticsUserDay.day] })
      .returning({ userId: analyticsUserDay.userId })
      .all();
    activeDayCache.add(cacheKey);
    if (inserted.length === 0) return;
    db.insert(analyticsEvent)
      .values({
        id: newId("anl"),
        name: "user_active",
        userId,
        value: 0,
        createdAt: now,
      })
      .run();
    bumpDaily(day, "user_active", 1, now);
  } catch (error) {
    warn(error);
  }
}

/** Deletes analytics rows past their retention window. Never throws. */
export function pruneAnalytics(now: Date = new Date()): void {
  try {
    db.delete(analyticsEvent)
      .where(lt(analyticsEvent.createdAt, new Date(now.getTime() - days(ANALYTICS_RETENTION_DAYS))))
      .run();
    db.delete(analyticsUserDay)
      .where(
        lt(
          analyticsUserDay.createdAt,
          new Date(now.getTime() - days(ANALYTICS_USER_DAY_RETENTION_DAYS)),
        ),
      )
      .run();
    lastPrunedAt = now.getTime();
  } catch (error) {
    warn(error);
  }
}

function days(count: number): number {
  return count * 24 * 60 * 60 * 1000;
}

/** Opportunistic pruning so long-lived containers stay bounded without a scheduler. */
function maybePrune(now: Date): void {
  if (now.getTime() - lastPrunedAt < PRUNE_INTERVAL_MS) return;
  lastPrunedAt = now.getTime();
  pruneAnalytics(now);
}

/** Test-only helper: forgets the per-process daily-active memo. */
export function resetAnalyticsCaches(): void {
  activeDayCache.clear();
  lastPrunedAt = 0;
}

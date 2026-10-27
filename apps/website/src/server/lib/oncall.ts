import {
  type CriticalAlertState,
  criticalAlertStateSchema,
  type OncallGroupDto,
  type OncallOverrideDto,
  type OncallPageCreateInput,
  type OncallPageCreateResponse,
  type OncallPageDto,
  type OncallPageStatus,
  type OncallPersonDto,
  type OncallRingingDto,
  type OncallRotationInput,
  type OncallSettingsDto,
  type OncallSettingsUpdateInput,
  type OncallShiftDto,
  oncallPageCreateSchema,
} from "@hark/contracts";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "../db";
import {
  app,
  device,
  oncallGroup,
  oncallOverride,
  oncallPage,
  oncallPageRecipient,
  oncallPreference,
  teamMember,
  user as userTable,
} from "../db/schema";
import { env } from "../env";
import { checkAppUrl, toAppSummaryDto } from "./apps";
import { checkNotificationAllowance, trackNotification } from "./billing";
import { newId } from "./id";
import {
  currentShift,
  isValidTimeZone,
  nextInRotation,
  normalizeRotationStart,
  type RotationConfig,
  type Shift,
  upcomingShifts,
} from "./oncall-schedule";
import {
  buildPageClaimedPushMessages,
  buildPagePushMessages,
  type PageTarget,
  sendPushMessages,
} from "./push";
import { memberIds } from "./teams";
import { generatePageResponseToken, hashPageResponseToken } from "./token";

export type GroupRow = typeof oncallGroup.$inferSelect;
export type PageRow = typeof oncallPage.$inferSelect;

const OPEN_STATUSES = ["triggered", "acknowledged"] as const;
const UPCOMING_SHIFTS = 5;

// ---------------------------------------------------------------------------
// Groups and schedules
// ---------------------------------------------------------------------------

export function rotationOf(group: GroupRow): RotationConfig {
  return {
    memberIds: group.memberIds,
    period: group.period === "weekly" ? "weekly" : "daily",
    handoffAt: group.handoffAt,
    timezone: group.timezone,
    startsAt: group.startsAt.getTime(),
  };
}

async function activeOverrides(groupId: string, now: number) {
  return db
    .select()
    .from(oncallOverride)
    .where(and(eq(oncallOverride.groupId, groupId), gt(oncallOverride.endsAt, new Date(now))))
    .orderBy(asc(oncallOverride.startsAt), asc(oncallOverride.id));
}

function overrideWindows(rows: Array<typeof oncallOverride.$inferSelect>) {
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    startsAt: row.startsAt.getTime(),
    endsAt: row.endsAt.getTime(),
  }));
}

export async function people(ids: Iterable<string>): Promise<Map<string, OncallPersonDto>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: userTable.id, name: userTable.name, image: userTable.image })
    .from(userTable)
    .where(inArray(userTable.id, unique));
  return new Map(rows.map((row) => [row.id, { userId: row.id, name: row.name, image: row.image }]));
}

function personOrUnknown(map: Map<string, OncallPersonDto>, id: string): OncallPersonDto {
  return map.get(id) ?? { userId: id, name: "Former member", image: null };
}

function toShiftDto(shift: Shift, map: Map<string, OncallPersonDto>): OncallShiftDto {
  return {
    person: personOrUnknown(map, shift.userId),
    startsAt: new Date(shift.startsAt).toISOString(),
    endsAt: new Date(shift.endsAt).toISOString(),
    override: shift.override,
    ...(shift.overrideId ? { overrideId: shift.overrideId } : {}),
  };
}

/** Who is on call right now, from the rotation or an override. */
export async function onCallNow(group: GroupRow, now = Date.now()): Promise<Shift | null> {
  const overrides = overrideWindows(await activeOverrides(group.id, now));
  return currentShift(rotationOf(group), overrides, now);
}

export async function toGroupDto(group: GroupRow, now = Date.now()): Promise<OncallGroupDto> {
  const overrideRows = await activeOverrides(group.id, now);
  const windows = overrideWindows(overrideRows);
  const rotation = rotationOf(group);
  const shifts = upcomingShifts(rotation, windows, now, UPCOMING_SHIFTS);
  const current = currentShift(rotation, windows, now);
  const map = await people([
    ...group.memberIds,
    ...overrideRows.map((row) => row.userId),
    ...shifts.map((shift) => shift.userId),
  ]);
  const [open] = await db
    .select({ value: count() })
    .from(oncallPage)
    .where(and(eq(oncallPage.groupId, group.id), inArray(oncallPage.status, [...OPEN_STATUSES])));
  const overrides: OncallOverrideDto[] = overrideRows.map((row) => ({
    id: row.id,
    person: personOrUnknown(map, row.userId),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  }));
  return {
    id: group.id,
    teamId: group.teamId,
    name: group.name,
    rotation: {
      members: group.memberIds.map((id) => personOrUnknown(map, id)),
      period: rotation.period,
      handoffAt: group.handoffAt,
      timezone: group.timezone,
      startsAt: group.startsAt.toISOString(),
    },
    escalation: group.escalation,
    ringIntervalSeconds: group.ringIntervalSeconds,
    ringMaxRepeats: group.ringMaxRepeats,
    current: current ? toShiftDto(current, map) : null,
    upcoming: shifts.map((shift) => toShiftDto(shift, map)),
    overrides,
    openPageCount: open?.value ?? 0,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

/** Group with its team, scoped to a member of that team. */
export async function memberGroup(
  groupId: string,
  userId: string,
): Promise<{ group: GroupRow; role: string } | undefined> {
  const [row] = await db
    .select({ group: oncallGroup, role: teamMember.role })
    .from(oncallGroup)
    .innerJoin(
      teamMember,
      and(eq(teamMember.teamId, oncallGroup.teamId), eq(teamMember.userId, userId)),
    )
    .where(eq(oncallGroup.id, groupId))
    .limit(1);
  return row;
}

export type RotationCheck =
  | {
      ok: true;
      values: Pick<GroupRow, "memberIds" | "period" | "handoffAt" | "timezone" | "startsAt">;
    }
  | { ok: false; error: string };

/** Validates a rotation against the team and normalizes its first handoff. */
export async function checkRotation(
  teamId: string,
  rotation: OncallRotationInput,
  now = Date.now(),
): Promise<RotationCheck> {
  if (!isValidTimeZone(rotation.timezone)) return { ok: false, error: "Unknown time zone" };
  const ordered = [...new Set(rotation.memberIds)];
  if (ordered.length !== rotation.memberIds.length) {
    return { ok: false, error: "Each member can appear in the rotation once" };
  }
  const members = new Set(await memberIds(teamId));
  if (!ordered.every((id) => members.has(id))) {
    return { ok: false, error: "Every rotation member must belong to the team" };
  }
  const startsAt = normalizeRotationStart(
    rotation.handoffAt,
    rotation.timezone,
    rotation.startsAt ? Date.parse(rotation.startsAt) : undefined,
    now,
  );
  return {
    ok: true,
    values: {
      memberIds: ordered,
      period: rotation.period,
      handoffAt: rotation.handoffAt,
      timezone: rotation.timezone,
      startsAt: new Date(startsAt),
    },
  };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export async function toPageDtos(rows: PageRow[]): Promise<OncallPageDto[]> {
  if (rows.length === 0) return [];
  const pageIds = rows.map((row) => row.id);
  const [groups, recipients, apps] = await Promise.all([
    db
      .select({ id: oncallGroup.id, name: oncallGroup.name })
      .from(oncallGroup)
      .where(inArray(oncallGroup.id, [...new Set(rows.map((row) => row.groupId))])),
    db
      .select()
      .from(oncallPageRecipient)
      .where(inArray(oncallPageRecipient.pageId, pageIds))
      .orderBy(asc(oncallPageRecipient.notifiedAt), asc(oncallPageRecipient.step)),
    db
      .select()
      .from(app)
      .where(
        inArray(
          app.id,
          rows.flatMap((row) => (row.appId ? [row.appId] : [])),
        ),
      ),
  ]);
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const appsById = new Map(apps.map((row) => [row.id, row]));
  const map = await people([
    ...recipients.map((recipient) => recipient.userId),
    ...rows
      .flatMap((row) => [row.acknowledgedByUserId, row.resolvedByUserId])
      .filter((id): id is string => typeof id === "string"),
  ]);
  return rows.map((row) => {
    const pageApp = row.appId ? appsById.get(row.appId) : undefined;
    return {
      id: row.id,
      groupId: row.groupId,
      groupName: groupNames.get(row.groupId) ?? "",
      teamId: row.teamId,
      title: row.title,
      body: row.body,
      url: row.url,
      app: pageApp ? toAppSummaryDto(pageApp) : null,
      status: row.status as OncallPageStatus,
      dedupKey: row.dedupKey,
      repeatCount: row.repeatCount,
      notified: recipients
        .filter((recipient) => recipient.pageId === row.id)
        .map((recipient) => personOrUnknown(map, recipient.userId)),
      ringing:
        row.status === "triggered"
          ? recipients
              .filter((recipient) => recipient.pageId === row.id && recipient.nextRingAt)
              .map(
                (recipient): OncallRingingDto => ({
                  person: personOrUnknown(map, recipient.userId),
                  ringCount: recipient.ringCount,
                  nextRingAt: (recipient.nextRingAt as Date).toISOString(),
                }),
              )
          : [],
      escalationStep: row.escalationStep,
      nextEscalationAt: row.nextEscalationAt?.toISOString() ?? null,
      acknowledgedBy: row.acknowledgedByUserId
        ? personOrUnknown(map, row.acknowledgedByUserId)
        : null,
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      resolvedBy: row.resolvedByUserId ? personOrUnknown(map, row.resolvedByUserId) : null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      source: row.sourceName,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function toPageDto(row: PageRow): Promise<OncallPageDto> {
  const [dto] = await toPageDtos([row]);
  return dto as OncallPageDto;
}

/** Page scoped to a member of its team. */
export async function memberPage(pageId: string, userId: string): Promise<PageRow | undefined> {
  const [row] = await db
    .select({ page: oncallPage })
    .from(oncallPage)
    .innerJoin(
      teamMember,
      and(eq(teamMember.teamId, oncallPage.teamId), eq(teamMember.userId, userId)),
    )
    .where(eq(oncallPage.id, pageId))
    .limit(1);
  return row?.page;
}

async function devicesOf(userIds: string[]) {
  if (userIds.length === 0) return [];
  return db
    .select({
      userId: device.userId,
      token: device.expoPushToken,
      criticalAlerts: device.criticalAlerts,
    })
    .from(device)
    .where(
      and(inArray(device.userId, userIds), eq(device.active, true), eq(device.platform, "ios")),
    );
}

async function deactivateStale(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.update(device).set({ active: false }).where(inArray(device.expoPushToken, tokens));
}

// ---------------------------------------------------------------------------
// Ringing: repeat alerts until someone acknowledges
// ---------------------------------------------------------------------------

type PreferenceRow = typeof oncallPreference.$inferSelect;

async function preferencesOf(userIds: string[]): Promise<Map<string, PreferenceRow>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(oncallPreference)
    .where(inArray(oncallPreference.userId, [...new Set(userIds)]));
  return new Map(rows.map((row) => [row.userId, row]));
}

/** Seconds between this person's repeat alerts, or null when they ring once. */
function ringInterval(group: GroupRow, preference: PreferenceRow | undefined): number | null {
  if (preference && !preference.ringUntilAcknowledged) return null;
  if (group.ringMaxRepeats <= 0) return null;
  return preference?.ringIntervalSeconds ?? group.ringIntervalSeconds;
}

function nextRingAfter(
  group: GroupRow,
  preference: PreferenceRow | undefined,
  ringCount: number,
  from: number,
): Date | null {
  const interval = ringInterval(group, preference);
  if (interval === null || ringCount >= group.ringMaxRepeats) return null;
  return new Date(from + interval * 1000);
}

/**
 * Sends one page alert to a person's iPhones: critical where the device
 * reported Critical Alerts as allowed, time-sensitive with the alarm sound
 * elsewhere. Every alert for a page shares a collapse ID, so a repeat
 * replaces the one on screen.
 */
async function sendPageAlert(
  page: PageRow,
  groupName: string,
  targets: Array<{ token: string; criticalAlerts: string | null }>,
  responseToken: string | undefined,
  ring: number,
): Promise<number> {
  if (targets.length === 0) return 0;
  const result = await sendPushMessages(
    buildPagePushMessages({
      to: targets.map(
        (target): PageTarget => ({
          token: target.token,
          critical: target.criticalAlerts === "authorized",
        }),
      ),
      pageId: page.id,
      teamId: page.teamId,
      groupName,
      title: page.title,
      body: page.body ?? `${groupName}: paged by ${page.sourceName}`,
      ...(responseToken ? { responseToken } : {}),
      ...(page.url ? { url: page.url } : {}),
      ...(page.appId ? { appId: page.appId } : {}),
      ring,
    }),
  );
  await deactivateStale(result.staleTokens);
  return result.accepted;
}

/**
 * Pages `userIds` (skipping anyone already notified), each with their own
 * one-shot lock-screen credential, and schedules their repeat alerts.
 * Returns pushes accepted by Expo.
 */
async function notifyRecipients(
  page: PageRow,
  group: GroupRow,
  userIds: string[],
  step: number,
): Promise<number> {
  let accepted = 0;
  const [targets, preferences] = await Promise.all([devicesOf(userIds), preferencesOf(userIds)]);
  for (const userId of userIds) {
    const responseToken = generatePageResponseToken();
    const now = Date.now();
    const inserted = await db
      .insert(oncallPageRecipient)
      .values({
        pageId: page.id,
        userId,
        step,
        responseTokenHash: hashPageResponseToken(responseToken),
        notifiedAt: new Date(now),
        nextRingAt: nextRingAfter(group, preferences.get(userId), 0, now),
      })
      .onConflictDoNothing()
      .returning({ userId: oncallPageRecipient.userId });
    if (inserted.length === 0) continue;
    const tokens = targets.filter((target) => target.userId === userId);
    if (tokens.length === 0) continue;
    const sent = await sendPageAlert(page, group.name, tokens, responseToken, 0);
    await db
      .update(oncallPageRecipient)
      .set({ acceptedCount: sent })
      .where(and(eq(oncallPageRecipient.pageId, page.id), eq(oncallPageRecipient.userId, userId)));
    accepted += sent;
  }
  return accepted;
}

/** Stops every repeat alert for a page (acknowledged or resolved). */
async function stopRinging(pageId: string): Promise<void> {
  await db
    .update(oncallPageRecipient)
    .set({ nextRingAt: null })
    .where(and(eq(oncallPageRecipient.pageId, pageId), isNotNull(oncallPageRecipient.nextRingAt)));
}

/**
 * Moves ringing to an escalation step's targets. A `next` step stops
 * everyone else; a `group` step makes every notified member due again on the
 * worker's next tick, so people handed off earlier hear it went to everyone.
 */
async function handOffRinging(
  page: PageRow,
  group: GroupRow,
  target: "next" | "group",
  newTargets: string[],
): Promise<void> {
  if (target === "next") {
    if (newTargets.length === 0) return;
    await db
      .update(oncallPageRecipient)
      .set({ nextRingAt: null })
      .where(
        and(
          eq(oncallPageRecipient.pageId, page.id),
          isNotNull(oncallPageRecipient.nextRingAt),
          sql`${oncallPageRecipient.userId} not in (${sql.join(
            newTargets.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
    return;
  }
  const team = new Set(await memberIds(group.teamId));
  const fresh = new Set(newTargets);
  const earlier = [...(await notifiedUserIds(page.id))].filter(
    (id) => team.has(id) && !fresh.has(id),
  );
  if (earlier.length === 0) return;
  const preferences = await preferencesOf(earlier);
  const now = new Date();
  for (const userId of earlier) {
    if (ringInterval(group, preferences.get(userId)) === null) continue;
    await db
      .update(oncallPageRecipient)
      .set({ nextRingAt: now, ringCount: 0 })
      .where(and(eq(oncallPageRecipient.pageId, page.id), eq(oncallPageRecipient.userId, userId)));
  }
}

const RINGS_PER_TICK = 100;

/**
 * Sends one due repeat alert. The recipient row is claimed by its ring count
 * and due time, so two workers (or a restart mid-tick) never send the same
 * repeat twice. Each repeat rotates the lock-screen credential; the previous
 * one stays valid for a tap that races the repeat.
 */
async function ringOnce(
  pageId: string,
  userId: string,
  ringCount: number,
  dueAt: Date,
  now: number,
): Promise<void> {
  const [row] = await db
    .select({ page: oncallPage, group: oncallGroup })
    .from(oncallPage)
    .innerJoin(oncallGroup, eq(oncallGroup.id, oncallPage.groupId))
    .where(eq(oncallPage.id, pageId))
    .limit(1);
  const recipient = and(
    eq(oncallPageRecipient.pageId, pageId),
    eq(oncallPageRecipient.userId, userId),
    eq(oncallPageRecipient.ringCount, ringCount),
    eq(oncallPageRecipient.nextRingAt, dueAt),
  );
  const team = row ? new Set(await memberIds(row.group.teamId)) : new Set<string>();
  const preference = (await preferencesOf([userId])).get(userId);
  if (
    row?.page.status !== "triggered" ||
    !team.has(userId) ||
    ringInterval(row.group, preference) === null ||
    ringCount >= row.group.ringMaxRepeats
  ) {
    await db.update(oncallPageRecipient).set({ nextRingAt: null }).where(recipient);
    return;
  }
  const { page, group } = row;
  const nextCount = ringCount + 1;
  const responseToken = generatePageResponseToken();
  const [claimed] = await db
    .update(oncallPageRecipient)
    .set({
      ringCount: nextCount,
      nextRingAt: nextRingAfter(group, preference, nextCount, now),
      previousResponseTokenHash: sql`case when ${oncallPageRecipient.responseTokenUsedAt} is null then ${oncallPageRecipient.responseTokenHash} else ${oncallPageRecipient.previousResponseTokenHash} end`,
      responseTokenHash: sql`case when ${oncallPageRecipient.responseTokenUsedAt} is null then ${hashPageResponseToken(responseToken)} else ${oncallPageRecipient.responseTokenHash} end`,
    })
    .where(recipient)
    .returning({ usedAt: oncallPageRecipient.responseTokenUsedAt });
  if (!claimed) return;
  const targets = await devicesOf([userId]);
  await sendPageAlert(
    page,
    group.name,
    targets,
    claimed.usedAt ? undefined : responseToken,
    nextCount,
  );
  // Acknowledged while this repeat was in flight: clear it again.
  const [latest] = await db
    .select({ status: oncallPage.status, ackBy: oncallPage.acknowledgedByUserId })
    .from(oncallPage)
    .where(eq(oncallPage.id, page.id))
    .limit(1);
  if (latest && latest.status !== "triggered" && targets.length > 0) {
    const claimedBy = latest.ackBy ? await userName(latest.ackBy) : "Someone";
    const result = await sendPushMessages(
      buildPageClaimedPushMessages(
        targets.map((target) => target.token),
        page.id,
        claimedBy,
      ),
    );
    await deactivateStale(result.staleTokens);
  }
}

/** Sends every due repeat alert. State lives in the database, so restarts resume. */
export async function processDueRings(now = new Date()): Promise<void> {
  const due = await db
    .select({
      pageId: oncallPageRecipient.pageId,
      userId: oncallPageRecipient.userId,
      ringCount: oncallPageRecipient.ringCount,
      nextRingAt: oncallPageRecipient.nextRingAt,
    })
    .from(oncallPageRecipient)
    .innerJoin(oncallPage, eq(oncallPage.id, oncallPageRecipient.pageId))
    .where(and(isNotNull(oncallPageRecipient.nextRingAt), lte(oncallPageRecipient.nextRingAt, now)))
    .orderBy(asc(oncallPageRecipient.nextRingAt))
    .limit(RINGS_PER_TICK);
  for (const ring of due) {
    if (!ring.nextRingAt) continue;
    try {
      await ringOnce(ring.pageId, ring.userId, ring.ringCount, ring.nextRingAt, now.getTime());
    } catch (error) {
      console.error("[oncall] Repeat alert failed", error);
    }
  }
}

// ---------------------------------------------------------------------------
// Personal paging settings
// ---------------------------------------------------------------------------

function criticalState(value: string | null): CriticalAlertState | null {
  const parsed = criticalAlertStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const CRITICAL_RANK: Record<CriticalAlertState, number> = {
  authorized: 3,
  notDetermined: 2,
  denied: 1,
  unavailable: 0,
};

export async function oncallSettings(userId: string): Promise<OncallSettingsDto> {
  const [preference] = await db
    .select()
    .from(oncallPreference)
    .where(eq(oncallPreference.userId, userId))
    .limit(1);
  const devices = await db
    .select({ id: device.id, deviceName: device.deviceName, criticalAlerts: device.criticalAlerts })
    .from(device)
    .where(and(eq(device.userId, userId), eq(device.active, true)))
    .orderBy(desc(device.lastSeenAt));
  const states = devices.map((row) => criticalState(row.criticalAlerts));
  const best = states
    .filter((state): state is CriticalAlertState => state !== null)
    .sort((a, b) => CRITICAL_RANK[b] - CRITICAL_RANK[a])[0];
  return {
    ringUntilAcknowledged: preference?.ringUntilAcknowledged ?? true,
    ringIntervalSeconds: preference?.ringIntervalSeconds ?? null,
    criticalAlerts: best ?? null,
    devices: devices.map((row, index) => ({
      id: row.id,
      deviceName: row.deviceName,
      criticalAlerts: states[index] ?? null,
    })),
  };
}

export async function updateOncallSettings(
  userId: string,
  input: OncallSettingsUpdateInput,
): Promise<OncallSettingsDto> {
  const now = new Date();
  const values = {
    ...(input.ringUntilAcknowledged !== undefined
      ? { ringUntilAcknowledged: input.ringUntilAcknowledged }
      : {}),
    ...(input.ringIntervalSeconds !== undefined
      ? { ringIntervalSeconds: input.ringIntervalSeconds }
      : {}),
    updatedAt: now,
  };
  await db
    .insert(oncallPreference)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: oncallPreference.userId, set: values });
  if (input.ringUntilAcknowledged === false) {
    // Turning ringing off silences pages that are ringing right now too.
    await db
      .update(oncallPageRecipient)
      .set({ nextRingAt: null })
      .where(
        and(eq(oncallPageRecipient.userId, userId), isNotNull(oncallPageRecipient.nextRingAt)),
      );
  }
  return oncallSettings(userId);
}

/** Rotation members still in the team, or the whole team when the rotation is empty. */
async function groupMembers(group: GroupRow): Promise<string[]> {
  const team = new Set(await memberIds(group.teamId));
  const rotation = group.memberIds.filter((id) => team.has(id));
  return rotation.length > 0 ? rotation : [...team];
}

function nextEscalationAt(group: GroupRow, step: number, from: number): Date | null {
  const next = group.escalation[step];
  return next ? new Date(from + next.afterMinutes * 60_000) : null;
}

export interface RaisePageInput {
  group: GroupRow;
  input: OncallPageCreateInput;
  /** Whose notification allowance the page counts against. */
  creatorUserId: string;
  sourceName: string;
}

export type RaisePageOutcome =
  | { ok: true; status: 200 | 201; body: OncallPageCreateResponse }
  | { ok: false; status: 400 | 429; error: string; retryAfterSeconds?: number };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Pages push high-priority alerts to other people, so every entry point
 * (webhooks, agent notifications, the on-call API) shares one per-minute
 * limit per group and per requesting user. Runs synchronously inside the
 * page insert's transaction, so a concurrent burst cannot all pass the count.
 */
function pageRateLimited(
  tx: Tx,
  group: GroupRow,
  creatorUserId: string,
): "group" | "account" | null {
  const since = new Date(Date.now() - 60_000);
  const groupUsage = tx
    .select({ value: count() })
    .from(oncallPage)
    .where(and(eq(oncallPage.groupId, group.id), gte(oncallPage.createdAt, since)))
    .get();
  if ((groupUsage?.value ?? 0) >= env.SERVICE_RATE_LIMIT_PER_MINUTE) return "group";
  const accountUsage = tx
    .select({ value: count() })
    .from(oncallPage)
    .where(and(eq(oncallPage.createdByUserId, creatorUserId), gte(oncallPage.createdAt, since)))
    .get();
  if ((accountUsage?.value ?? 0) >= env.ACCOUNT_RATE_LIMIT_PER_MINUTE) return "account";
  return null;
}

/**
 * Whether an Idempotency-Key retry (`dedupKey`) would merge into an open
 * page that `userId` can see but that was raised with a different payload.
 * Webhook and agent callers answer 409 then, like their non-paging paths.
 */
export async function idempotentPageConflict(
  userId: string,
  groupId: string,
  input: unknown,
): Promise<boolean> {
  const parsed = oncallPageCreateSchema.safeParse(input);
  if (!parsed.success || !parsed.data.dedupKey) return false;
  const [open] = await db
    .select({ page: oncallPage })
    .from(oncallPage)
    .innerJoin(
      teamMember,
      and(eq(teamMember.teamId, oncallPage.teamId), eq(teamMember.userId, userId)),
    )
    .where(
      and(
        eq(oncallPage.groupId, groupId),
        eq(oncallPage.dedupKey, parsed.data.dedupKey),
        inArray(oncallPage.status, [...OPEN_STATUSES]),
      ),
    )
    .limit(1);
  if (!open) return false;
  return (
    open.page.title !== parsed.data.title ||
    open.page.body !== (parsed.data.body ?? null) ||
    open.page.url !== (parsed.data.url ?? null) ||
    open.page.appId !== (parsed.data.appId ?? null)
  );
}

async function mergeDuplicate(group: GroupRow, dedupKey: string): Promise<PageRow | undefined> {
  const [merged] = await db
    .update(oncallPage)
    .set({
      repeatCount: sql`${oncallPage.repeatCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(oncallPage.groupId, group.id),
        eq(oncallPage.dedupKey, dedupKey),
        inArray(oncallPage.status, [...OPEN_STATUSES]),
      ),
    )
    .returning();
  return merged;
}

/**
 * Raises a page on a group: it goes to whoever is on call now (or the whole
 * group when nobody is), then escalates on the group's schedule until
 * someone acknowledges. Duplicate `dedupKey`s merge into the open page.
 */
export async function raisePage({
  group,
  input,
  creatorUserId,
  sourceName,
}: RaisePageInput): Promise<RaisePageOutcome> {
  let appId: string | null = null;
  if (input.appId) {
    const [row] = await db
      .select()
      .from(app)
      .where(and(eq(app.id, input.appId), eq(app.teamId, group.teamId)))
      .limit(1);
    if (!row) return { ok: false, status: 400, error: "appId must be one of the team's apps" };
    const checked = checkAppUrl(row, input.url);
    if (!checked.ok) return { ok: false, status: 400, error: checked.error };
    appId = row.id;
  }

  if (input.dedupKey) {
    const merged = await mergeDuplicate(group, input.dedupKey);
    if (merged) {
      return {
        ok: true,
        status: 200,
        body: { page: await toPageDto(merged), deduplicated: true, accepted: 0 },
      };
    }
  }

  if (!(await checkNotificationAllowance(creatorUserId))) {
    return { ok: false, status: 429, error: "Monthly notification limit reached" };
  }

  const now = Date.now();
  const team = new Set(await memberIds(group.teamId));
  const shift = await onCallNow(group, now);
  const initial = shift && team.has(shift.userId) ? [shift.userId] : await groupMembers(group);

  const values: typeof oncallPage.$inferInsert = {
    id: newId("page"),
    groupId: group.id,
    teamId: group.teamId,
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    appId,
    status: "triggered",
    dedupKey: input.dedupKey ?? null,
    escalationStep: 0,
    nextEscalationAt: nextEscalationAt(group, 0, now),
    lastPagedUserId: initial.length === 1 ? (initial[0] ?? null) : null,
    sourceName,
    createdByUserId: creatorUserId,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  let created: PageRow | "group" | "account";
  try {
    created = db.transaction((tx) => {
      const limited = pageRateLimited(tx, group, creatorUserId);
      if (limited) return limited;
      const inserted = tx.insert(oncallPage).values(values).returning().get();
      if (!inserted) throw new Error("Failed to create page");
      return inserted;
    });
  } catch (error) {
    // A concurrent page with the same key won the open-page unique index.
    if (input.dedupKey) {
      const merged = await mergeDuplicate(group, input.dedupKey);
      if (merged) {
        return {
          ok: true,
          status: 200,
          body: { page: await toPageDto(merged), deduplicated: true, accepted: 0 },
        };
      }
    }
    throw error;
  }
  if (typeof created === "string") {
    return {
      ok: false,
      status: 429,
      error:
        created === "group"
          ? "On-call group page rate limit exceeded"
          : "Account page rate limit exceeded",
      retryAfterSeconds: 60,
    };
  }
  const page = created;

  const accepted = await notifyRecipients(page, group, initial, 0);
  if (accepted > 0) await trackNotification(creatorUserId, page.id);
  return {
    ok: true,
    status: 201,
    body: { page: await toPageDto(page), deduplicated: false, accepted },
  };
}

async function notifiedUserIds(pageId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: oncallPageRecipient.userId })
    .from(oncallPageRecipient)
    .where(eq(oncallPageRecipient.pageId, pageId));
  return new Set(rows.map((row) => row.userId));
}

export type EscalateOutcome =
  | { ok: true; page: PageRow }
  | { ok: false; status: 404 | 409; error: string; page?: PageRow };

/**
 * Runs the page's next escalation step. The worker calls this when a step
 * is due; a person can run it early. Past the last configured step a manual
 * escalation pages the whole group.
 */
export async function escalatePage(pageId: string, manual: boolean): Promise<EscalateOutcome> {
  const [row] = await db
    .select({ page: oncallPage, group: oncallGroup })
    .from(oncallPage)
    .innerJoin(oncallGroup, eq(oncallGroup.id, oncallPage.groupId))
    .where(eq(oncallPage.id, pageId))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "Page not found" };
  const { page, group } = row;
  if (page.status !== "triggered") {
    return { ok: false, status: 409, error: `Page is already ${page.status}`, page };
  }
  const stepIndex = page.escalationStep;
  const configured = group.escalation[stepIndex];
  const step = configured ?? (manual ? { afterMinutes: 0, target: "group" as const } : null);
  const now = Date.now();
  if (!step) {
    await db
      .update(oncallPage)
      .set({ nextEscalationAt: null })
      .where(and(eq(oncallPage.id, page.id), eq(oncallPage.escalationStep, stepIndex)));
    return { ok: true, page: { ...page, nextEscalationAt: null } };
  }

  const notified = await notifiedUserIds(page.id);
  const team = new Set(await memberIds(group.teamId));
  let targets: string[];
  let lastPagedUserId = page.lastPagedUserId;
  if (step.target === "next") {
    const rotation = rotationOf(group);
    const next = nextInRotation(
      { ...rotation, memberIds: rotation.memberIds.filter((id) => team.has(id)) },
      page.lastPagedUserId,
      notified,
      now,
    );
    targets = next ? [next] : [];
    if (next) lastPagedUserId = next;
  } else {
    targets = (await groupMembers(group)).filter((id) => !notified.has(id));
  }
  if (manual && targets.length === 0) {
    return { ok: false, status: 409, error: "Everyone in the group has already been paged", page };
  }

  // Claimed by step number, so the worker and a person cannot run a step twice.
  const [claimed] = await db
    .update(oncallPage)
    .set({
      escalationStep: stepIndex + 1,
      nextEscalationAt: nextEscalationAt(group, stepIndex + 1, now),
      lastPagedUserId,
      updatedAt: new Date(now),
    })
    .where(
      and(
        eq(oncallPage.id, page.id),
        eq(oncallPage.status, "triggered"),
        eq(oncallPage.escalationStep, stepIndex),
      ),
    )
    .returning();
  if (!claimed) {
    const [latest] = await db.select().from(oncallPage).where(eq(oncallPage.id, page.id)).limit(1);
    return { ok: false, status: 409, error: "Page changed; try again", page: latest ?? page };
  }
  await handOffRinging(claimed, group, step.target, targets);
  const accepted = await notifyRecipients(claimed, group, targets, stepIndex + 1);
  if (accepted > 0 && claimed.createdByUserId) {
    await trackNotification(claimed.createdByUserId, `${claimed.id}:${stepIndex + 1}`);
  }
  return { ok: true, page: claimed };
}

/** Clears the page from everyone else's devices once it is claimed. */
async function sendClaimed(page: PageRow, exceptUserId: string, claimedBy: string): Promise<void> {
  const recipients = [...(await notifiedUserIds(page.id))].filter((id) => id !== exceptUserId);
  const targets = await devicesOf(recipients);
  if (targets.length === 0) return;
  const result = await sendPushMessages(
    buildPageClaimedPushMessages(
      targets.map((target) => target.token),
      page.id,
      claimedBy,
    ),
  );
  await deactivateStale(result.staleTokens);
}

async function userName(userId: string): Promise<string> {
  const [row] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.name ?? "Someone";
}

export type PageTransition =
  | { ok: true; page: PageRow }
  | { ok: false; status: 409; error: string; page: PageRow };

/** First acknowledgement wins; it stops escalation and clears everyone else's alert. */
export async function acknowledgePage(page: PageRow, userId: string): Promise<PageTransition> {
  const now = new Date();
  const [updated] = await db
    .update(oncallPage)
    .set({
      status: "acknowledged",
      acknowledgedByUserId: userId,
      acknowledgedAt: now,
      nextEscalationAt: null,
      updatedAt: now,
    })
    .where(and(eq(oncallPage.id, page.id), eq(oncallPage.status, "triggered")))
    .returning();
  if (!updated) {
    const [latest] = await db.select().from(oncallPage).where(eq(oncallPage.id, page.id)).limit(1);
    const current = latest ?? page;
    return { ok: false, status: 409, error: `Page is already ${current.status}`, page: current };
  }
  await stopRinging(updated.id);
  void sendClaimed(updated, userId, await userName(userId)).catch((error: unknown) => {
    console.error("[oncall] Could not send page.claimed", error);
  });
  return { ok: true, page: updated };
}

export async function resolvePage(
  page: PageRow,
  userId: string,
  note: string | undefined,
): Promise<PageTransition> {
  const now = new Date();
  const [updated] = await db
    .update(oncallPage)
    .set({
      status: "resolved",
      resolvedByUserId: userId,
      resolvedAt: now,
      resolveNote: note ?? null,
      nextEscalationAt: null,
      updatedAt: now,
    })
    .where(and(eq(oncallPage.id, page.id), inArray(oncallPage.status, [...OPEN_STATUSES])))
    .returning();
  if (!updated) {
    const [latest] = await db.select().from(oncallPage).where(eq(oncallPage.id, page.id)).limit(1);
    return { ok: false, status: 409, error: "Page is already resolved", page: latest ?? page };
  }
  await stopRinging(updated.id);
  // An unacknowledged page is still ringing on phones; clear it.
  if (page.status === "triggered") {
    void sendClaimed(updated, userId, await userName(userId)).catch((error: unknown) => {
      console.error("[oncall] Could not send page.claimed", error);
    });
  }
  return { ok: true, page: updated };
}

/** Resolves a lock-screen credential to its page and recipient. */
export async function pageRecipientByToken(pageId: string, responseToken: string) {
  const [row] = await db
    .select({
      page: oncallPage,
      userId: oncallPageRecipient.userId,
      usedAt: oncallPageRecipient.responseTokenUsedAt,
    })
    .from(oncallPageRecipient)
    .innerJoin(oncallPage, eq(oncallPage.id, oncallPageRecipient.pageId))
    .innerJoin(
      teamMember,
      and(
        eq(teamMember.teamId, oncallPage.teamId),
        eq(teamMember.userId, oncallPageRecipient.userId),
      ),
    )
    .where(
      and(
        eq(oncallPageRecipient.pageId, pageId),
        or(
          eq(oncallPageRecipient.responseTokenHash, hashPageResponseToken(responseToken)),
          eq(oncallPageRecipient.previousResponseTokenHash, hashPageResponseToken(responseToken)),
        ),
      ),
    )
    .limit(1);
  return row;
}

export interface PageListQuery {
  status?: string;
  cursor?: string;
  limit?: string;
}

function encodeCursor(row: PageRow): string {
  return Buffer.from(`${row.createdAt.getTime()}:${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(value: string): { createdAt: number; id: string } | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const separator = decoded.indexOf(":");
  const createdAt = Number.parseInt(decoded.slice(0, separator), 10);
  const id = decoded.slice(separator + 1);
  if (separator <= 0 || !Number.isFinite(createdAt) || !id) return null;
  return { createdAt, id };
}

export async function listTeamPages(
  teamId: string,
  query: PageListQuery,
): Promise<
  | { ok: true; body: { pages: OncallPageDto[]; nextCursor: string | null } }
  | { ok: false; error: string }
> {
  const status = query.status ?? "open";
  if (status !== "open" && status !== "all")
    return { ok: false, error: "status must be open or all" };
  const limit = Number.parseInt(query.limit ?? "20", 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return { ok: false, error: "limit must be between 1 and 50" };
  }
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  if (cursor === null) return { ok: false, error: "Invalid cursor" };
  const filters = [eq(oncallPage.teamId, teamId)];
  if (status === "open") filters.push(inArray(oncallPage.status, [...OPEN_STATUSES]));
  if (cursor) {
    const at = new Date(cursor.createdAt);
    filters.push(
      or(
        lt(oncallPage.createdAt, at),
        and(eq(oncallPage.createdAt, at), lt(oncallPage.id, cursor.id)),
      ) as SQL,
    );
  }
  const rows = await db
    .select()
    .from(oncallPage)
    .where(and(...filters))
    .orderBy(desc(oncallPage.createdAt), desc(oncallPage.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    ok: true,
    body: {
      pages: await toPageDtos(page),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    },
  };
}

/** Open pages that notified the user, newest first. */
export async function openPagesFor(userId: string): Promise<OncallPageDto[]> {
  const rows = await db
    .select({ page: oncallPage })
    .from(oncallPage)
    .innerJoin(
      oncallPageRecipient,
      and(eq(oncallPageRecipient.pageId, oncallPage.id), eq(oncallPageRecipient.userId, userId)),
    )
    .innerJoin(
      teamMember,
      and(eq(teamMember.teamId, oncallPage.teamId), eq(teamMember.userId, userId)),
    )
    .where(inArray(oncallPage.status, [...OPEN_STATUSES]))
    .orderBy(desc(oncallPage.createdAt))
    .limit(50);
  return toPageDtos(rows.map((row) => row.page));
}

// ---------------------------------------------------------------------------
// Escalation worker
// ---------------------------------------------------------------------------

let running: Promise<void> | null = null;

/** Runs every due escalation step. State lives in the database, so restarts resume. */
export function processDueEscalations(now = new Date()): Promise<void> {
  if (running) return running;
  running = (async () => {
    const due = await db
      .select({ id: oncallPage.id })
      .from(oncallPage)
      .where(
        and(
          eq(oncallPage.status, "triggered"),
          isNotNull(oncallPage.nextEscalationAt),
          lte(oncallPage.nextEscalationAt, now),
        ),
      )
      .orderBy(asc(oncallPage.nextEscalationAt))
      .limit(50);
    for (const { id } of due) {
      try {
        await escalatePage(id, false);
      } catch (error) {
        console.error("[oncall] Escalation failed", error);
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

let ringing: Promise<void> | null = null;

/** Escalations first (they hand ringing off), then repeat alerts. */
function processOncallWork(): Promise<void> {
  if (ringing) return ringing;
  ringing = (async () => {
    await processDueEscalations();
    await processDueRings();
  })()
    .catch((error: unknown) => console.error("[oncall] Worker tick failed", error))
    .finally(() => {
      ringing = null;
    });
  return ringing;
}

/** Every 5 s, so a 30 s repeat interval stays close to on time. */
export function startOncallEscalationWorker(): () => void {
  void processOncallWork();
  const timer = setInterval(() => void processOncallWork(), 5_000);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Claims a lock-screen credential for one action. Credentials are single-use:
 * the first successful acknowledge or escalate spends it. Returns false when
 * it was already spent (including by a concurrent request).
 */
export async function claimPageResponseToken(pageId: string, userId: string): Promise<boolean> {
  const claimed = await db
    .update(oncallPageRecipient)
    .set({ responseTokenUsedAt: new Date() })
    .where(
      and(
        eq(oncallPageRecipient.pageId, pageId),
        eq(oncallPageRecipient.userId, userId),
        isNull(oncallPageRecipient.responseTokenUsedAt),
      ),
    )
    .returning({ userId: oncallPageRecipient.userId });
  return claimed.length > 0;
}

/** Returns a claimed credential when its action did not happen. */
export async function releasePageResponseToken(pageId: string, userId: string): Promise<void> {
  await db
    .update(oncallPageRecipient)
    .set({ responseTokenUsedAt: null })
    .where(and(eq(oncallPageRecipient.pageId, pageId), eq(oncallPageRecipient.userId, userId)));
}

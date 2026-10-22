import { TEAM_FREE_SEATS, type TeamDto } from "@hark/contracts";
import { Autumn } from "autumn-js";
import { env } from "../env";

/**
 * Team seat billing. The Autumn customer for a team is the team itself
 * (customer ID = team ID), separate from every member's personal plan. The
 * first seat is free; any further member needs the `team_monthly` plan,
 * which bills the `seats` feature per seat. Without Autumn (development,
 * tests, self-hosting) seats are unlimited.
 */

const TEAM_PLAN_ID = "team_monthly";
const SEATS_FEATURE_ID = "seats";
const CACHE_TTL_MS = 60_000;

// `failOpen: false`: the SDK otherwise answers a 5xx or network failure
// with a synthetic free customer (and `allowed: true`). Errors reach the
// catch blocks below instead, which keep the last known plan.
const autumn = env.AUTUMN_API_KEY
  ? new Autumn({ secretKey: env.AUTUMN_API_KEY, timeoutMs: 5_000, failOpen: false })
  : null;

const planCache = new Map<string, { paid: boolean; expiresAt: number }>();

const unlimitedOwners = new Set(
  (env.UNLIMITED_TEAM_OWNER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

/** Comped team: its owner is listed in UNLIMITED_TEAM_OWNER_EMAILS. Never billed. */
export function teamIsComped(team: Pick<TeamCustomer, "email">): boolean {
  return Boolean(team.email && unlimitedOwners.has(team.email.toLowerCase()));
}

export function teamBillingConfigured(): boolean {
  return autumn !== null;
}

interface TeamCustomer {
  id: string;
  name: string;
  /** Billing contact: the owner's email. */
  email?: string;
}

async function ensureCustomer(team: TeamCustomer) {
  if (!autumn) throw new Error("Billing is not configured");
  return autumn.customers.getOrCreate({
    customerId: team.id,
    name: team.name,
    ...(team.email ? { email: team.email } : {}),
  });
}

/** Whether the team has an active paid team plan. Cached briefly; fails closed to free. */
export async function teamHasPaidPlan(team: TeamCustomer, useCache = true): Promise<boolean> {
  if (!autumn) return false;
  const cached = planCache.get(team.id);
  if (useCache && cached && cached.expiresAt > Date.now()) return cached.paid;
  try {
    const customer = await ensureCustomer(team);
    const paid = customer.subscriptions.some(
      (subscription) =>
        subscription.planId === TEAM_PLAN_ID &&
        subscription.status === "active" &&
        !subscription.pastDue,
    );
    if (planCache.size > 10_000) {
      // Evict expired entries only; clearing would drop every team's
      // last-known plan, which the catch below falls back to.
      const now = Date.now();
      for (const [id, entry] of planCache) if (entry.expiresAt <= now) planCache.delete(id);
    }
    planCache.set(team.id, { paid, expiresAt: Date.now() + CACHE_TTL_MS });
    return paid;
  } catch (error) {
    console.error("[team-billing] Could not load team customer", error);
    return cached?.paid ?? false;
  }
}

export async function teamSeats(
  team: TeamCustomer,
  used: number,
): Promise<Pick<TeamDto, "seats" | "plan">> {
  if (!autumn) return { plan: "free", seats: { used, available: null, billable: 0 } };
  if (teamIsComped(team)) return { plan: "team", seats: { used, available: null, billable: 0 } };
  const paid = await teamHasPaidPlan(team);
  return paid
    ? {
        plan: "team",
        seats: { used, available: null, billable: Math.max(0, used - TEAM_FREE_SEATS) },
      }
    : { plan: "free", seats: { used, available: TEAM_FREE_SEATS, billable: 0 } };
}

/** Whether the team can grow to `nextCount` members. */
export async function teamCanSeat(team: TeamCustomer, nextCount: number): Promise<boolean> {
  if (!autumn || nextCount <= TEAM_FREE_SEATS || teamIsComped(team)) return true;
  return teamHasPaidPlan(team, false);
}

/** Reports the current member count as seat usage. Best effort; never throws. */
export async function syncTeamSeats(team: TeamCustomer, memberCount: number): Promise<void> {
  if (!autumn || teamIsComped(team)) return;
  try {
    if (!(await teamHasPaidPlan(team))) return;
    await autumn.balances.update({
      customerId: team.id,
      featureId: SEATS_FEATURE_ID,
      usage: memberCount,
    });
  } catch (error) {
    console.error("[team-billing] Could not sync team seats", error);
  }
}

export async function createTeamCheckout(team: TeamCustomer, memberCount: number): Promise<string> {
  if (!autumn) throw new Error("Billing is not configured");
  await ensureCustomer(team);
  const result = await autumn.billing.attach({
    customerId: team.id,
    planId: TEAM_PLAN_ID,
    redirectMode: "always",
    successUrl: `${env.APP_URL}/dashboard/teams/${encodeURIComponent(team.id)}?billing=success`,
    checkoutSessionParams: { managed_payments: { enabled: false } },
  });
  planCache.delete(team.id);
  if (!result.paymentUrl) throw new Error("Autumn did not return a checkout URL");
  // Seats already in use are reported as soon as the plan is attached.
  void syncTeamSeats(team, memberCount);
  return result.paymentUrl;
}

export async function createTeamBillingPortal(team: TeamCustomer): Promise<string> {
  if (!autumn) throw new Error("Billing is not configured");
  await ensureCustomer(team);
  const result = await autumn.billing.openCustomerPortal({
    customerId: team.id,
    returnUrl: `${env.APP_URL}/dashboard/teams/${encodeURIComponent(team.id)}`,
  });
  return result.url;
}

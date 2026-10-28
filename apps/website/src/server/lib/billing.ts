import type { BillingDto, PricingPlanDto, PricingPlansDto } from "@hark/contracts";
import { Autumn } from "autumn-js";
import {
  FREE_NOTIFICATIONS,
  PRO_NOTIFICATIONS,
  PRO_PRICE_MONTHLY,
  staticPricingPlans,
} from "../../shared/pricing";
import { env } from "../env";
import type { AuthedUser } from "../middleware";
import { track } from "./analytics";

const CACHE_TTL_MS = 60_000;

// `failOpen: false`: the SDK otherwise answers a 5xx or network failure
// with a synthetic free customer (and `allowed: true`). Errors reach the
// catch blocks below instead, which keep the last known plan.
const autumn = env.AUTUMN_API_KEY
  ? new Autumn({ secretKey: env.AUTUMN_API_KEY, timeoutMs: 5_000, failOpen: false })
  : null;

const cache = new Map<string, { value: BillingDto; expiresAt: number }>();
/** Per-process memo so an observed free → pro transition is recorded once. */
const upgradesRecorded = new Set<string>();

function recordUpgrade(userId: string, previous: BillingDto | undefined, next: BillingDto): void {
  if (next.plan !== "pro" || previous?.plan !== "free" || upgradesRecorded.has(userId)) return;
  if (upgradesRecorded.size > 10_000) upgradesRecorded.clear();
  upgradesRecorded.add(userId);
  track({ name: "plan_upgraded", userId, plan: "pro", outcome: "free_to_pro" });
}

function freeBilling(): BillingDto {
  return {
    configured: autumn !== null,
    plan: "free",
    priceMonthly: PRO_PRICE_MONTHLY,
    features: { deviceRouting: false },
    limits: {
      devices: 1,
      notificationsPerMonth: FREE_NOTIFICATIONS,
      servicePerMinute: env.SERVICE_RATE_LIMIT_PER_MINUTE,
      accountPerMinute: env.ACCOUNT_RATE_LIMIT_PER_MINUTE,
    },
    usage: { notificationsRemaining: FREE_NOTIFICATIONS },
  };
}

function toBilling(
  customer: Awaited<ReturnType<NonNullable<typeof autumn>["customers"]["getOrCreate"]>>,
): BillingDto {
  const isPro = customer.subscriptions.some(
    (subscription) =>
      subscription.planId === "pro_monthly" &&
      subscription.status === "active" &&
      !subscription.pastDue,
  );
  const notificationBalance = customer.balances.notifications;

  return {
    configured: true,
    plan: isPro ? "pro" : "free",
    priceMonthly: PRO_PRICE_MONTHLY,
    features: { deviceRouting: Boolean(customer.flags.device_routing) },
    limits: {
      devices: isPro ? null : 1,
      notificationsPerMonth: isPro ? PRO_NOTIFICATIONS : FREE_NOTIFICATIONS,
      servicePerMinute: isPro
        ? env.PRO_SERVICE_RATE_LIMIT_PER_MINUTE
        : env.SERVICE_RATE_LIMIT_PER_MINUTE,
      accountPerMinute: isPro
        ? env.PRO_ACCOUNT_RATE_LIMIT_PER_MINUTE
        : env.ACCOUNT_RATE_LIMIT_PER_MINUTE,
    },
    usage: {
      notificationsRemaining:
        typeof notificationBalance?.remaining === "number" ? notificationBalance.remaining : null,
    },
  };
}

export function hasAutumn(): boolean {
  return autumn !== null;
}

const PLANS_CACHE_TTL_MS = 5 * 60_000;
let plansCache: { value: PricingPlansDto; expiresAt: number } | null = null;

function rateLimits(pro: boolean): Pick<PricingPlanDto, "servicePerMinute" | "accountPerMinute"> {
  return pro
    ? {
        servicePerMinute: env.PRO_SERVICE_RATE_LIMIT_PER_MINUTE,
        accountPerMinute: env.PRO_ACCOUNT_RATE_LIMIT_PER_MINUTE,
      }
    : {
        servicePerMinute: env.SERVICE_RATE_LIMIT_PER_MINUTE,
        accountPerMinute: env.ACCOUNT_RATE_LIMIT_PER_MINUTE,
      };
}

/** Mirrors autumn.config.ts, used when Autumn is unreachable or not configured. */
function staticPlans(): PricingPlansDto {
  return staticPricingPlans({
    freeServicePerMinute: env.SERVICE_RATE_LIMIT_PER_MINUTE,
    freeAccountPerMinute: env.ACCOUNT_RATE_LIMIT_PER_MINUTE,
  });
}

/**
 * Public pricing data, sourced live from the Autumn plan catalog so the
 * pricing page cannot drift from what checkout actually attaches.
 */
/** Plans existing customers keep but nobody new can buy. */
export const RETIRED_PLAN_IDS = new Set(["pro_monthly"]);

export async function getPricingPlans(): Promise<PricingPlansDto> {
  if (!autumn) return staticPlans();
  if (plansCache && plansCache.expiresAt > Date.now()) return plansCache.value;

  try {
    const response = await autumn.plans.list();
    const plans = response.list
      // Team seats are billed to the team, not shown as a personal plan. Pro
      // is kept only for existing subscribers and is no longer sold.
      .filter(
        (plan) =>
          !plan.addOn &&
          !plan.archived &&
          plan.id !== "team_monthly" &&
          !RETIRED_PLAN_IDS.has(plan.id),
      )
      .map((plan): PricingPlanDto => {
        const item = (featureId: string) =>
          plan.items.find((candidate) => candidate.featureId === featureId);
        const metered = (featureId: string, fallback: number | null) => {
          const found = item(featureId);
          if (!found) return fallback;
          return found.unlimited ? null : found.included;
        };
        return {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          priceMonthly: plan.price?.amount ?? 0,
          notificationsPerMonth: metered("notifications", null),
          devices: metered("devices", null),
          deviceRouting: item("device_routing") !== undefined,
          ...rateLimits(item("higher_rate_limits") !== undefined),
        };
      })
      .sort((a, b) => a.priceMonthly - b.priceMonthly);
    if (plans.length === 0) return staticPlans();

    const value: PricingPlansDto = { source: "autumn", plans };
    plansCache = { value, expiresAt: Date.now() + PLANS_CACHE_TTL_MS };
    return value;
  } catch (error) {
    console.error("[billing] Could not list Autumn plans", error);
    return plansCache?.value ?? staticPlans();
  }
}

export function clearBillingCache(userId: string): void {
  cache.delete(userId);
}

export async function getBilling(user: AuthedUser, useCache = false): Promise<BillingDto> {
  if (!autumn) return freeBilling();

  const cached = cache.get(user.id);
  if (useCache && cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const customer = await autumn.customers.getOrCreate({
      customerId: user.id,
      name: user.name,
      email: user.email,
      autoEnablePlanId: "free",
    });
    const value = toBilling(customer);
    recordUpgrade(user.id, cached?.value, value);
    cache.set(user.id, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.error("[billing] Could not load Autumn customer", error);
    const fallback = cached?.value ?? freeBilling();
    cache.set(user.id, { value: fallback, expiresAt: Date.now() + 15_000 });
    return fallback;
  }
}

export async function checkNotificationAllowance(userId: string): Promise<boolean> {
  if (!autumn) return true;
  try {
    return (await autumn.check({ customerId: userId, featureId: "notifications" })).allowed;
  } catch (error) {
    console.error("[billing] Could not check notification allowance", error);
    return true;
  }
}

export async function trackNotification(userId: string, eventId: string): Promise<void> {
  if (!autumn) return;
  try {
    await autumn.track({
      customerId: userId,
      featureId: "notifications",
      value: 1,
      properties: { eventId },
    });
    const cached = cache.get(userId);
    if (cached && typeof cached.value.usage.notificationsRemaining === "number") {
      cached.value.usage.notificationsRemaining = Math.max(
        0,
        cached.value.usage.notificationsRemaining - 1,
      );
    }
  } catch (error) {
    console.error("[billing] Could not track notification usage", error);
  }
}

export async function createCheckout(user: AuthedUser): Promise<string> {
  if (!autumn) throw new Error("Billing is not configured");
  await autumn.customers.getOrCreate({
    customerId: user.id,
    name: user.name,
    email: user.email,
    autoEnablePlanId: "free",
  });
  const result = await autumn.billing.attach({
    customerId: user.id,
    planId: "pro_monthly",
    redirectMode: "always",
    successUrl: `${env.APP_URL}/dashboard?billing=success`,
    checkoutSessionParams: { managed_payments: { enabled: false } },
  });
  clearBillingCache(user.id);
  if (!result.paymentUrl) throw new Error("Autumn did not return a checkout URL");
  return result.paymentUrl;
}

export async function createBillingPortal(user: AuthedUser): Promise<string> {
  if (!autumn) throw new Error("Billing is not configured");
  const result = await autumn.billing.openCustomerPortal({
    customerId: user.id,
    returnUrl: `${env.APP_URL}/dashboard`,
  });
  return result.url;
}

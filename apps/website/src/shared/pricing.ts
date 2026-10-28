import type * as Contracts from "@hark/contracts";
import type { PricingPlansDto } from "@hark/contracts";

// Mirrors of contract constants, typed against them so a change fails typecheck
// without pulling zod (the contracts runtime) into the client bundle.
export const TEAM_SEAT_PRICE_MONTHLY: typeof Contracts.TEAM_SEAT_PRICE_MONTHLY = 5;
export const TEAM_FREE_SEATS: typeof Contracts.TEAM_FREE_SEATS = 0;

export const FREE_NOTIFICATIONS = 10_000;
export const PRO_NOTIFICATIONS = 100_000;
export const PRO_PRICE_MONTHLY = 8;

interface PricingRateLimits {
  freeServicePerMinute: number;
  freeAccountPerMinute: number;
  proServicePerMinute: number;
  proAccountPerMinute: number;
}

const defaultRateLimits: PricingRateLimits = {
  freeServicePerMinute: 60,
  freeAccountPerMinute: 300,
  proServicePerMinute: 300,
  proAccountPerMinute: 1_500,
};

/** Public fallback catalog, also used as the prerendered pricing-page state. */
export function staticPricingPlans(limits: PricingRateLimits = defaultRateLimits): PricingPlansDto {
  return {
    source: "static",
    plans: [
      {
        id: "free",
        name: "Free",
        description: "Everything needed for personal webhook notifications.",
        priceMonthly: 0,
        notificationsPerMonth: FREE_NOTIFICATIONS,
        devices: 1,
        deviceRouting: false,
        servicePerMinute: limits.freeServicePerMinute,
        accountPerMinute: limits.freeAccountPerMinute,
      },
    ],
  };
}

/** Per-seat team plan copy; billed per team, not part of the personal plan catalog. */
export const TEAM_PLAN = {
  id: "team",
  name: "Team",
  description: "Shared apps and on-call for the people you work with.",
  seatPriceMonthly: TEAM_SEAT_PRICE_MONTHLY,
  freeSeats: TEAM_FREE_SEATS,
  features: [
    "Every member is one seat, including you",
    "Team apps, invites and roles",
    "On-call rotations and escalation",
    "Acknowledge, escalate and resolve from the lock screen",
  ],
} as const;

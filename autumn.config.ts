import { feature, item, plan } from "atmn";

// Features
export const notifications = feature({
  id: "notifications",
  name: "Notifications",
  type: "metered",
  consumable: true,
});

export const higherRateLimits = feature({
  id: "higher_rate_limits",
  name: "Higher rate limits",
  type: "boolean",
});

export const deviceRouting = feature({
  id: "device_routing",
  name: "Device routing",
  type: "boolean",
});

export const devices = feature({
  id: "devices",
  name: "iPhones",
  type: "metered",
  consumable: false,
});

/** Members of a team. The Autumn customer for a team is the team itself. */
export const seats = feature({
  id: "seats",
  name: "Team seats",
  type: "metered",
  consumable: false,
});

// Plans
export const freeV1 = plan({
  id: "free",
  version: 1,
  name: "Free",
  description: "Everything needed for personal webhook notifications.",
  group: "main",
  autoEnable: true,
  items: [
    item({
      featureId: devices.id,
      included: 1,
    }),
    item({
      featureId: notifications.id,
      included: 10000,
      reset: {
        interval: "month",
      },
    }),
  ],
});

/** No longer offered to new customers; kept for existing Pro subscribers. */
export const pro = plan({
  id: "pro_monthly",
  name: "Pro",
  description: "Multiple iPhones, targeted routing, and higher limits.",
  group: "main",
  price: {
    amount: 8,
    interval: "month",
  },
  items: [
    item({ featureId: deviceRouting.id }),
    item({ featureId: higherRateLimits.id }),
    item({
      featureId: devices.id,
      unlimited: true,
    }),
    item({
      featureId: notifications.id,
      included: 100000,
      reset: {
        interval: "month",
      },
    }),
  ],
});

/**
 * Team plan, attached to the team's own customer (ID = team ID). Every seat
 * is $5/month (TEAM_SEAT_PRICE_MONTHLY), the creator's included
 * (TEAM_FREE_SEATS = 0), billed monthly on the number of members (usage-based seats).
 */
export const teamMonthly = plan({
  id: "team_monthly",
  name: "Team",
  description: "Shared apps and on-call paging for your team, per seat.",
  group: "team",
  items: [
    item({
      featureId: seats.id,
      included: 0,
      price: {
        amount: 5,
        interval: "month",
        billingMethod: "usage_based",
        billingUnits: 1,
      },
    }),
  ],
});

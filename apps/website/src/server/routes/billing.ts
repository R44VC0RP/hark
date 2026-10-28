import type { BillingRedirectResponse } from "@hark/contracts";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { user as userTable } from "../db/schema";
import { track } from "../lib/analytics";
import { createBillingPortal, getBilling, getPricingPlans, hasAutumn } from "../lib/billing";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";

export const billingRoute = new Hono<AuthedEnv>()
  // Public: the pricing page reads the plan catalog without a session.
  .get("/plans", async (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(await getPricingPlans());
  })
  .use("*", requireAuth)
  .get("/", async (c) => c.json(await getBilling(c.get("user"))))
  // Hark Pro is no longer sold: personal use is free, teams pay per seat
  // (POST /api/teams/:id/billing/checkout). Existing Pro subscribers keep
  // their plan and manage it from the portal below.
  .post("/checkout", (c) =>
    c.json(
      {
        error:
          "Hark Pro is no longer offered. Personal use is free; teams are $5 per seat per month.",
      },
      410,
    ),
  )
  .post("/portal", async (c) => {
    if (!hasAutumn()) return c.json({ error: "Billing is not configured" }, 503);
    try {
      const url = await createBillingPortal(c.get("user"));
      track({ name: "billing_portal_opened", userId: c.get("user").id });
      return c.json<BillingRedirectResponse>({ url });
    } catch (error) {
      console.error("[billing] Could not create customer portal", error);
      return c.json({ error: "Could not open billing portal" }, 502);
    }
  });

/**
 * Read-only billing for agent tokens, mounted at `/api/agent/billing`.
 * Checkout and the customer portal stay session-only: both start payment
 * flows that only the account owner should open.
 */
export const billingAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/", requireScopes("billing:read"), async (c) => {
    const [owner] = await db
      .select({ id: userTable.id, name: userTable.name, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, c.get("apiToken").userId))
      .limit(1);
    if (!owner) return c.json({ error: "Account not found" }, 404);
    return c.json(await getBilling(owner));
  });

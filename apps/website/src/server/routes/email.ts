import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { db } from "../db";
import { emailUnsubscribe, user } from "../db/schema";
import { verifyUnsubscribeToken } from "../lib/email-unsubscribe";

/** `r***@gmail.com`: enough to recognise the account, not enough to leak it. */
function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

/** Resolves `?u=&t=` to an account, or null when the link is wrong. */
async function linkedUser(c: Context) {
  const userId = c.req.query("u") ?? "";
  if (!verifyUnsubscribeToken(userId, c.req.query("t") ?? "")) return null;
  return (
    (await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .get()) ?? null
  );
}

async function isUnsubscribed(userId: string): Promise<boolean> {
  const row = await db
    .select({ userId: emailUnsubscribe.userId })
    .from(emailUnsubscribe)
    .where(eq(emailUnsubscribe.userId, userId))
    .get();
  return Boolean(row);
}

const INVALID = { error: "This unsubscribe link doesn't work", code: "not_found" } as const;

/**
 * Product-email opt-out, authorised by the signed link in each email (no
 * sign-in). POST /unsubscribe also serves RFC 8058 one-click requests from
 * mail apps (body `List-Unsubscribe=One-Click`, which is ignored).
 */
export const emailRoute = new Hono()
  .get("/subscription", async (c) => {
    const account = await linkedUser(c);
    if (!account) return c.json(INVALID, 404);
    return c.json({
      email: maskEmail(account.email),
      unsubscribed: await isUnsubscribed(account.id),
    });
  })
  .post("/unsubscribe", async (c) => {
    const account = await linkedUser(c);
    if (!account) return c.json(INVALID, 404);
    await db
      .insert(emailUnsubscribe)
      .values({ userId: account.id, createdAt: new Date() })
      .onConflictDoNothing();
    return c.json({ email: maskEmail(account.email), unsubscribed: true });
  })
  .post("/resubscribe", async (c) => {
    const account = await linkedUser(c);
    if (!account) return c.json(INVALID, 404);
    await db.delete(emailUnsubscribe).where(eq(emailUnsubscribe.userId, account.id));
    return c.json({ email: maskEmail(account.email), unsubscribed: false });
  });

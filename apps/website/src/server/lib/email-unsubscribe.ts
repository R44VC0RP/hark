import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";

/**
 * Unsubscribe links for product emails. The token is an HMAC of the user ID,
 * so a link works without signing in and only for that one account. Rotating
 * BETTER_AUTH_SECRET invalidates links in emails already sent. Links look like
 * `${APP_URL}/unsubscribe?u=<userId>&t=<token>` (the page) and
 * `${APP_URL}/api/email/unsubscribe?u=<userId>&t=<token>` (RFC 8058 one-click).
 */
const PURPOSE = "hark:email-unsubscribe:v1:";

export function unsubscribeToken(userId: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(PURPOSE + userId)
    .digest("base64url")
    .slice(0, 32);
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  if (!userId || !token) return false;
  const expected = Buffer.from(unsubscribeToken(userId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

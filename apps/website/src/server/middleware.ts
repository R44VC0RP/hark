import type { ApiTokenScope } from "@hark/contracts";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { auth } from "./auth";
import { db } from "./db";
import { apiToken } from "./db/schema";
import { trackUserActive } from "./lib/analytics";
import { isPublicOrigin } from "./lib/origins";
import { hashApiToken } from "./lib/token";

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export type AuthedEnv = {
  Variables: {
    user: AuthedUser;
  };
};

export type AgentEnv = {
  Variables: {
    apiToken: typeof apiToken.$inferSelect;
  };
};

/** True when a browser says the request comes from a page outside Hark's own origins. */
export function hasForeignOrigin(c: {
  req: { header(name: string): string | undefined };
}): boolean {
  const origin = c.req.header("origin");
  return Boolean(
    (origin && !isPublicOrigin(origin)) ||
      c.req.header("sec-fetch-site")?.toLowerCase() === "cross-site",
  );
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Derives the user from the Better Auth session cookie. Rejects anonymous
 * requests, and cross-site state changes so the cookie alone (SameSite=Lax)
 * is not the only CSRF defence. Native app requests carry no Origin.
 */
export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method) && hasForeignOrigin(c)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  });
  trackUserActive(session.user.id);
  await next();
});

/**
 * Env binding the MCP server sets when it dispatches a tool call through the
 * agent routes in-process. A symbol key cannot arrive from the network: the
 * Node adapter builds `c.env` itself, so only `app.fetch(request, env)` calls
 * from server code can set it.
 */
export const INTERNAL_AGENT_TOKEN: unique symbol = Symbol("hark.internalAgentToken");

export type InternalAgentEnv = { [INTERNAL_AGENT_TOKEN]: typeof apiToken.$inferSelect };

/** Authenticates a scoped agent token without retaining or logging its plaintext value. */
export const requireApiToken = createMiddleware<AgentEnv>(async (c, next) => {
  const internal = (c.env as Partial<InternalAgentEnv> | undefined)?.[INTERNAL_AGENT_TOKEN];
  if (internal) {
    // Already authenticated (an OAuth access token at /mcp) by the dispatcher.
    c.set("apiToken", internal);
    await next();
    return;
  }

  const authorization = c.req.header("authorization");
  const match = authorization?.match(/^Bearer (hark_[A-Za-z0-9_-]{40,})$/i);
  if (!match?.[1]) return c.json({ error: "Unauthorized" }, 401);

  const now = new Date();
  const [token] = await db
    .select()
    .from(apiToken)
    .where(
      and(
        eq(apiToken.tokenHash, hashApiToken(match[1])),
        isNull(apiToken.revokedAt),
        // NULL expiry is handled after lookup because SQLite comparisons exclude it.
      ),
    )
    .limit(1);
  if (!token || (token.expiresAt && token.expiresAt <= now)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("apiToken", token);
  trackUserActive(token.userId);
  if (!token.lastUsedAt || token.lastUsedAt.getTime() <= now.getTime() - 60_000) {
    await db
      .update(apiToken)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiToken.id, token.id),
          or(
            isNull(apiToken.lastUsedAt),
            lte(apiToken.lastUsedAt, new Date(now.getTime() - 60_000)),
          ),
        ),
      );
  }
  await next();
});

export function requireScopes(...required: ApiTokenScope[]) {
  return createMiddleware<AgentEnv>(async (c, next) => {
    const granted = new Set(c.get("apiToken").scopes);
    if (!required.every((scope) => granted.has(scope))) {
      return c.json({ error: "Insufficient scope", required }, 403);
    }
    await next();
  });
}

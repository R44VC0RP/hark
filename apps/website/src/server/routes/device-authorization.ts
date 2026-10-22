import {
  type ApiTokenDto,
  type ApiTokenScope,
  type DeviceAuthorizationRequestDto,
  deviceAuthorizationStartSchema,
} from "@hark/contracts";
import { and, count, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { apiToken, deviceAuthorizationRequest } from "../db/schema";
import { env } from "../env";
import { track } from "../lib/analytics";
import { newId } from "../lib/id";
import {
  apiTokenPrefix,
  generateApiToken,
  generateDeviceCode,
  generateUserCode,
  hashApiToken,
  hashDeviceCode,
  MAX_ACTIVE_API_TOKENS,
} from "../lib/token";
import { type AuthedEnv, hasForeignOrigin, requireAuth } from "../middleware";

const REQUEST_TTL_SECONDS = 600;
const INITIAL_POLL_INTERVAL_SECONDS = 5;
const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * A client IP is only trustworthy when an edge we control sets it, and any header a
 * client can send is attacker-controlled: rotating it would hand out a fresh bucket
 * and defeat the per-client limit. Returns null unless TRUSTED_CLIENT_IP_HEADER names
 * a header the edge is known to overwrite, in which case per-client limits resume.
 */
export function requestKey(c: {
  req: { header(name: string): string | undefined };
}): string | null {
  if (!env.TRUSTED_CLIENT_IP_HEADER) return null;
  const value = c.req.header(env.TRUSTED_CLIENT_IP_HEADER)?.split(",", 1)[0]?.trim();
  return value || null;
}

function consumeLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current && buckets.size >= 10_000) {
    for (const [candidate, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(candidate);
    }
    if (buckets.size >= 10_000) return false;
  }
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

/** Without a trusted client key the shared bucket is the only honest control. */
function rateLimited(kind: string, key: string | null, limit: number): boolean {
  if (key !== null && !consumeLimit(`${kind}:client:${key}`, limit, 60_000)) return true;
  return !consumeLimit(`${kind}:global`, limit * 20, 60_000);
}

function codeRateLimited(userId: string, clientKey: string | null): boolean {
  return (
    rateLimited("code", clientKey === null ? null : `${userId}:${clientKey}`, 30) ||
    // Keyed by session, so this bucket cannot be reset with a request header.
    rateLimited("code-user", userId, 60)
  );
}

function normalizeUserCode(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(normalized)) return null;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/** Keeps the network, drops the host: the last IPv4 octet or the last 64 bits of IPv6. */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = ip.match(/^(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/i);
  if (v4) return `${v4[1]}.x`;
  if (ip.includes(":")) {
    const groups = ip.split("::")[0]?.split(":").filter(Boolean).slice(0, 4) ?? [];
    return `${groups.join(":")}::x`;
  }
  return null;
}

function requestDto(
  row: typeof deviceAuthorizationRequest.$inferSelect,
): DeviceAuthorizationRequestDto {
  return {
    clientName: row.clientName,
    scopes: row.requestedScopes as ApiTokenScope[],
    status: row.status as DeviceAuthorizationRequestDto["status"],
    userCode: row.userCode,
    expiresAt: row.expiresAt.toISOString(),
    tokenExpiresAt: row.tokenExpiresAt.toISOString(),
    startedAt: row.createdAt.toISOString(),
    requesterUserAgent: row.requesterUserAgent,
    requesterIp: row.requesterIp,
  };
}

function tokenDto(row: typeof apiToken.$inferSelect): ApiTokenDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes as ApiTokenScope[],
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function expireRequest(row: typeof deviceAuthorizationRequest.$inferSelect) {
  if (!(["pending", "approved"] as string[]).includes(row.status) || row.expiresAt > new Date()) {
    return row;
  }
  const now = new Date();
  return (
    db
      .update(deviceAuthorizationRequest)
      .set({ status: "expired", resolvedAt: row.resolvedAt ?? now })
      .where(
        and(
          eq(deviceAuthorizationRequest.id, row.id),
          inArray(deviceAuthorizationRequest.status, ["pending", "approved"]),
          lte(deviceAuthorizationRequest.expiresAt, now),
        ),
      )
      .returning()
      .get() ?? row
  );
}

export const deviceAuthorizationRoute = new Hono<AuthedEnv>()
  .post("/start", async (c) => {
    if (rateLimited("start", requestKey(c), 20)) {
      c.header("Retry-After", "60");
      return c.json({ error: "rate_limited" }, 429);
    }
    const parsed = deviceAuthorizationStartSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }

    const now = new Date();
    const purgeBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    db.delete(deviceAuthorizationRequest)
      .where(
        or(
          lte(deviceAuthorizationRequest.expiresAt, purgeBefore),
          and(
            inArray(deviceAuthorizationRequest.status, ["denied", "expired", "consumed"]),
            lte(deviceAuthorizationRequest.resolvedAt, purgeBefore),
          ),
        ),
      )
      .run();
    const expiresAt = new Date(now.getTime() + REQUEST_TTL_SECONDS * 1000);
    const tokenExpiresAt = new Date(now.getTime() + parsed.data.expiresInSeconds * 1000);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const deviceCode = generateDeviceCode();
      const userCode = generateUserCode();
      try {
        db.insert(deviceAuthorizationRequest)
          .values({
            id: newId("dar"),
            deviceCodeHash: hashDeviceCode(deviceCode),
            userCode,
            clientName: parsed.data.clientName,
            requestedScopes: parsed.data.scopes,
            status: "pending",
            expiresAt,
            tokenExpiresAt,
            pollIntervalSeconds: INITIAL_POLL_INTERVAL_SECONDS,
            createdAt: now,
            requesterUserAgent: c.req.header("user-agent")?.trim().slice(0, 200) || null,
            requesterIp: maskIp(requestKey(c)),
          })
          .run();
        const verificationUri = `${env.APP_URL.replace(/\/$/, "")}/cli/authorize`;
        return c.json(
          {
            deviceCode,
            userCode,
            verificationUri,
            verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
            expiresIn: REQUEST_TTL_SECONDS,
            interval: INITIAL_POLL_INTERVAL_SECONDS,
          },
          201,
        );
      } catch {
        // Unique collisions are extraordinarily unlikely; generate an entirely new pair.
      }
    }
    return c.json({ error: "temporarily_unavailable" }, 503);
  })
  .post("/token", async (c) => {
    if (rateLimited("poll", requestKey(c), 120)) {
      c.header("Retry-After", "60");
      return c.json({ error: "rate_limited", interval: 60 }, 429);
    }
    const body = (await c.req.json().catch(() => null)) as { deviceCode?: unknown } | null;
    if (typeof body?.deviceCode !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.deviceCode)) {
      return c.json({ error: "invalid_request" }, 400);
    }

    const now = new Date();
    const result = db.transaction((tx) => {
      const row = tx
        .select()
        .from(deviceAuthorizationRequest)
        .where(
          eq(deviceAuthorizationRequest.deviceCodeHash, hashDeviceCode(body.deviceCode as string)),
        )
        .get();
      if (!row) return { kind: "invalid" } as const;

      if (row.expiresAt <= now && row.status !== "consumed") {
        tx.update(deviceAuthorizationRequest)
          .set({ status: "expired", resolvedAt: row.resolvedAt ?? now, lastPollAt: now })
          .where(eq(deviceAuthorizationRequest.id, row.id))
          .run();
        return { kind: "expired" } as const;
      }

      const elapsed = row.lastPollAt
        ? now.getTime() - row.lastPollAt.getTime()
        : Number.POSITIVE_INFINITY;
      if (elapsed < row.pollIntervalSeconds * 1000 - 100) {
        const interval = Math.min(row.pollIntervalSeconds + 5, 30);
        tx.update(deviceAuthorizationRequest)
          .set({ lastPollAt: now, pollIntervalSeconds: interval })
          .where(eq(deviceAuthorizationRequest.id, row.id))
          .run();
        return { kind: "slow", interval } as const;
      }

      tx.update(deviceAuthorizationRequest)
        .set({ lastPollAt: now })
        .where(eq(deviceAuthorizationRequest.id, row.id))
        .run();
      if (row.status === "pending") {
        return { kind: "pending", interval: row.pollIntervalSeconds } as const;
      }
      if (row.status === "denied") return { kind: "denied" } as const;
      if (row.status === "expired") return { kind: "expired" } as const;
      if (row.status === "consumed") return { kind: "consumed" } as const;
      if (row.status !== "approved" || !row.approvedUserId) return { kind: "invalid" } as const;

      const active = tx
        .select({ value: count() })
        .from(apiToken)
        .where(
          and(
            eq(apiToken.userId, row.approvedUserId),
            isNull(apiToken.revokedAt),
            // Connected OAuth clients do not count against the token limit.
            isNull(apiToken.oauthClientId),
            or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, now)),
          ),
        )
        .get();
      if ((active?.value ?? 0) >= MAX_ACTIVE_API_TOKENS) {
        tx.update(deviceAuthorizationRequest)
          .set({ status: "denied", resolvedAt: now })
          .where(eq(deviceAuthorizationRequest.id, row.id))
          .run();
        return { kind: "limit" } as const;
      }

      const consumed = tx
        .update(deviceAuthorizationRequest)
        .set({ status: "consumed", consumedAt: now })
        .where(
          and(
            eq(deviceAuthorizationRequest.id, row.id),
            eq(deviceAuthorizationRequest.status, "approved"),
            gt(deviceAuthorizationRequest.expiresAt, now),
          ),
        )
        .returning({ id: deviceAuthorizationRequest.id })
        .get();
      if (!consumed) return { kind: "consumed" } as const;

      const secret = generateApiToken();
      const token = tx
        .insert(apiToken)
        .values({
          id: newId("tok"),
          userId: row.approvedUserId,
          name: row.clientName,
          tokenHash: hashApiToken(secret),
          prefix: apiTokenPrefix(secret),
          scopes: row.requestedScopes,
          expiresAt: row.tokenExpiresAt,
          createdAt: now,
        })
        .returning()
        .get();
      return { kind: "token", secret, token } as const;
    });

    if (result.kind === "token") {
      track({
        name: "api_token_created",
        userId: result.token.userId,
        outcome: "cli",
        metadata: { scopeCount: (result.token.scopes as string[]).length },
      });
      return c.json({ accessToken: result.secret, token: tokenDto(result.token) });
    }
    if (result.kind === "pending") {
      return c.json({ error: "authorization_pending", interval: result.interval }, 400);
    }
    if (result.kind === "slow") {
      return c.json({ error: "slow_down", interval: result.interval }, 400);
    }
    if (result.kind === "denied") return c.json({ error: "access_denied" }, 400);
    if (result.kind === "expired") return c.json({ error: "expired_token" }, 400);
    if (result.kind === "limit") return c.json({ error: "token_limit_reached" }, 409);
    if (result.kind === "consumed") return c.json({ error: "invalid_grant" }, 400);
    return c.json({ error: "invalid_request" }, 400);
  })
  .use("/requests/*", requireAuth)
  .get("/requests/:code", async (c) => {
    const user = c.get("user");
    if (codeRateLimited(user.id, requestKey(c))) {
      c.header("Retry-After", "60");
      return c.json({ error: "Too many authorization attempts" }, 429);
    }
    const code = normalizeUserCode(c.req.param("code"));
    if (!code) return c.json({ error: "Authorization request not found" }, 404);
    const row = db
      .select()
      .from(deviceAuthorizationRequest)
      .where(eq(deviceAuthorizationRequest.userCode, code))
      .get();
    if (!row) return c.json({ error: "Authorization request not found" }, 404);
    return c.json({ request: requestDto(expireRequest(row)) });
  })
  .post("/requests/:code/approve", async (c) => {
    if (hasForeignOrigin(c)) return c.json({ error: "Forbidden" }, 403);
    if (codeRateLimited(c.get("user").id, requestKey(c))) {
      c.header("Retry-After", "60");
      return c.json({ error: "Too many authorization attempts" }, 429);
    }
    const code = normalizeUserCode(c.req.param("code"));
    if (!code) return c.json({ error: "Authorization request not found" }, 404);
    const now = new Date();
    const row = db
      .update(deviceAuthorizationRequest)
      .set({ status: "approved", approvedUserId: c.get("user").id, resolvedAt: now })
      .where(
        and(
          eq(deviceAuthorizationRequest.userCode, code),
          eq(deviceAuthorizationRequest.status, "pending"),
          gt(deviceAuthorizationRequest.expiresAt, now),
        ),
      )
      .returning()
      .get();
    if (!row) return c.json({ error: "Authorization request is no longer pending" }, 409);
    track({
      name: "cli_authorization_approved",
      userId: c.get("user").id,
      metadata: { scopeCount: (row.requestedScopes as string[]).length },
    });
    return c.json({ request: requestDto(row) });
  })
  .post("/requests/:code/deny", async (c) => {
    if (hasForeignOrigin(c)) return c.json({ error: "Forbidden" }, 403);
    if (codeRateLimited(c.get("user").id, requestKey(c))) {
      c.header("Retry-After", "60");
      return c.json({ error: "Too many authorization attempts" }, 429);
    }
    const code = normalizeUserCode(c.req.param("code"));
    if (!code) return c.json({ error: "Authorization request not found" }, 404);
    const now = new Date();
    const row = db
      .update(deviceAuthorizationRequest)
      .set({ status: "denied", approvedUserId: null, resolvedAt: now })
      .where(
        and(
          eq(deviceAuthorizationRequest.userCode, code),
          eq(deviceAuthorizationRequest.status, "pending"),
          gt(deviceAuthorizationRequest.expiresAt, now),
        ),
      )
      .returning()
      .get();
    if (!row) return c.json({ error: "Authorization request is no longer pending" }, 409);
    return c.json({ request: requestDto(row) });
  });

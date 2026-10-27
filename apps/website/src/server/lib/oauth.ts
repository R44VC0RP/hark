import { createHash, randomBytes } from "node:crypto";
import {
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  MCP_PATH,
  OAUTH_DEFAULT_SCOPES,
  OAUTH_OFFLINE_ACCESS_SCOPE,
  OAUTH_SCOPES,
  type OAuthClientGrantDto,
} from "@hark/contracts";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  apiToken,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "../db/schema";
import { track, trackUserActive } from "./analytics";
import { newId } from "./id";
import { canonicalOrigin, publicOrigins } from "./origins";

/**
 * Hark is its own OAuth 2.1 authorization server (Better Auth's
 * `@better-auth/oauth-provider`) for exactly one protected resource: the
 * remote MCP server at `/mcp`. Access tokens are opaque and stored hashed,
 * so revoking a client takes effect on its very next request.
 */

/** Prefixes make leaked tokens recognizable to secret scanners. Never stored. */
export const OAUTH_ACCESS_TOKEN_PREFIX = "hark_mat_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "hark_mrt_";

/** Short-lived access; clients with `offline_access` refresh silently. */
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 3600;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Path of the consent (and sign-in) page the authorize endpoint redirects to. */
export const OAUTH_CONSENT_PAGE = "/oauth/consent";

const API_SCOPE_SET = new Set<string>(API_TOKEN_SCOPES);

export function appOrigin(): string {
  return canonicalOrigin();
}

/**
 * The MCP server's URL on `origin` (default: the canonical one): the OAuth
 * resource indicator and audience. Clients use whichever origin they were
 * set up with, so metadata answers with the origin the request came in on.
 */
export function mcpResourceUrl(origin = appOrigin()): string {
  return `${origin}${MCP_PATH}`;
}

/** Every accepted token audience: the MCP URL on each public origin. */
export function mcpResourceUrls(): string[] {
  return publicOrigins().map((origin) => mcpResourceUrl(origin));
}

/** Better Auth's issuer: its base URL including the `/api/auth` base path. */
export function oauthIssuerUrl(): string {
  return `${appOrigin()}/api/auth`;
}

export function protectedResourceMetadataUrl(origin = appOrigin()): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

/**
 * RFC 9728 protected resource metadata for `/mcp` as reached on `origin`.
 * The authorization server is always the canonical issuer.
 */
export function protectedResourceMetadata(origin = appOrigin()) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [oauthIssuerUrl()],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Hark",
    resource_documentation: `${appOrigin()}/docs#mcp`,
  };
}

/**
 * The `WWW-Authenticate` challenge `/mcp` sends with a 401. The `scope`
 * parameter tells MCP clients which scopes to request by default.
 */
export function mcpAuthChallenge(
  error?: { code: string; description: string },
  origin = appOrigin(),
): string {
  const parts = [
    `resource_metadata="${protectedResourceMetadataUrl(origin)}"`,
    `scope="${OAUTH_DEFAULT_SCOPES.join(" ")}"`,
  ];
  if (error) {
    parts.push(`error="${error.code}"`, `error_description="${error.description}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

/**
 * Storage hash for OAuth tokens and authorization codes (SHA-256, base64url).
 * The OAuth provider uses this same function, so lookups here match.
 */
export function hashOAuthToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return value.split(/[\s,]+/).filter(Boolean);
  }
}

/** Keeps only Hark API scopes, in their canonical order. */
export function apiScopesOf(scopes: readonly string[]): ApiTokenScope[] {
  const granted = new Set(scopes);
  return API_TOKEN_SCOPES.filter((scope) => granted.has(scope) && API_SCOPE_SET.has(scope));
}

/** The default scope request, narrowed to what the client registered for. */
export function defaultScopesFor(clientScopes: unknown): string[] {
  const allowed = parseScopes(clientScopes);
  if (allowed.length === 0) return [...OAUTH_DEFAULT_SCOPES];
  const set = new Set(allowed);
  return OAUTH_DEFAULT_SCOPES.filter((scope) => set.has(scope));
}

export async function clientDefaultScopes(clientId: string): Promise<string[]> {
  const [row] = await db
    .select({ scopes: oauthClient.scopes })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  return defaultScopesFor(row?.scopes);
}

export type ApiTokenRow = typeof apiToken.$inferSelect;

export interface OAuthCaller {
  /** The grant's API token row, with `scopes` narrowed to this access token. */
  token: ApiTokenRow;
  clientId: string;
  clientName: string;
  userId: string;
  scopes: ApiTokenScope[];
}

export type OAuthAuthResult =
  | { ok: true; caller: OAuthCaller }
  | { ok: false; reason: "missing" | "invalid" };

/** Resolves an `Authorization: Bearer hark_mat_…` header to the calling grant. */
export async function authenticateOAuthBearer(
  authorization: string | undefined,
): Promise<OAuthAuthResult> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) return { ok: false, reason: "missing" };
  const presented = match[1];
  if (!presented.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return { ok: false, reason: "invalid" };
  const stored = hashOAuthToken(presented.slice(OAUTH_ACCESS_TOKEN_PREFIX.length));

  const now = new Date();
  const [row] = await db
    .select({ access: oauthAccessToken, client: oauthClient })
    .from(oauthAccessToken)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthAccessToken.clientId))
    .where(eq(oauthAccessToken.token, stored))
    .limit(1);
  if (!row?.access.userId || !row.access.expiresAt || row.access.expiresAt <= now) {
    return { ok: false, reason: "invalid" };
  }
  if (row.client.disabled) return { ok: false, reason: "invalid" };

  const scopes = apiScopesOf(parseScopes(row.access.scopes));
  const clientName = row.client.name?.trim() || "MCP client";
  const grant = ensureGrantToken(row.access.userId, row.client.clientId, clientName, scopes, now);
  trackUserActive(grant.userId);
  return {
    ok: true,
    caller: {
      token: { ...grant, scopes },
      clientId: row.client.clientId,
      clientName,
      userId: row.access.userId,
      scopes,
    },
  };
}

/**
 * Finds or creates the API token row that stands for a user's grant to one
 * OAuth client. Agent routes scope ownership (prompts, Live Activities,
 * idempotency keys) to a token ID, so this row gives the client one stable
 * identity across access-token refreshes. It holds no usable secret.
 */
function ensureGrantToken(
  userId: string,
  clientId: string,
  clientName: string,
  scopes: ApiTokenScope[],
  now: Date,
): ApiTokenRow {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(apiToken)
      .where(
        and(
          eq(apiToken.userId, userId),
          eq(apiToken.oauthClientId, clientId),
          isNull(apiToken.revokedAt),
        ),
      )
      .get();
    if (existing) {
      const stale = !existing.lastUsedAt || existing.lastUsedAt.getTime() <= now.getTime() - 60_000;
      const scopesChanged =
        JSON.stringify(apiScopesOf(existing.scopes as string[])) !== JSON.stringify(scopes);
      if (!stale && !scopesChanged && existing.name === clientName) return existing;
      // Keeps the stored scopes at the latest consent for listings.
      return (
        tx
          .update(apiToken)
          .set({
            name: clientName,
            ...(scopesChanged ? { scopes } : {}),
            ...(stale ? { lastUsedAt: now } : {}),
          })
          .where(eq(apiToken.id, existing.id))
          .returning()
          .get() ?? existing
      );
    }
    const created = tx
      .insert(apiToken)
      .values({
        id: newId("tok"),
        userId,
        name: clientName,
        // Random and never revealed: this row cannot authenticate by itself.
        tokenHash: `oauth:${randomBytes(32).toString("base64url")}`,
        prefix: "oauth",
        scopes,
        createdAt: now,
        lastUsedAt: now,
        oauthClientId: clientId,
      })
      .returning()
      .get();
    track({
      name: "api_token_created",
      userId,
      outcome: "oauth",
      metadata: { scopeCount: scopes.length, expires: false },
    });
    return created;
  });
}

/**
 * Signs a client out of one account: deletes its access and refresh tokens
 * and remembered consent, and revokes the grant's API token row. The client
 * must ask for consent again to reconnect. Returns false when nothing was
 * connected.
 */
export function revokeOAuthGrant(
  userId: string,
  clientId: string,
  outcome: "dashboard" | "agent",
): boolean {
  const changed = db.transaction((tx) => {
    const access = tx
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)))
      .run().changes;
    const refresh = tx
      .delete(oauthRefreshToken)
      .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)))
      .run().changes;
    const consent = tx
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
      .run().changes;
    const grants = tx
      .update(apiToken)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiToken.userId, userId),
          eq(apiToken.oauthClientId, clientId),
          isNull(apiToken.revokedAt),
        ),
      )
      .run().changes;
    return access + refresh + consent + grants > 0;
  });
  if (changed) {
    track({ name: "api_token_revoked", userId, outcome, metadata: { kind: "oauth" } });
  }
  return changed;
}

function redirectHostsOf(value: unknown): string[] {
  const hosts = new Set<string>();
  for (const uri of parseScopes(value)) {
    try {
      const url = new URL(uri);
      hosts.add(url.hostname || url.protocol.replace(/:$/, ""));
    } catch {
      // Ignore malformed stored URIs.
    }
  }
  return [...hosts];
}

/**
 * Every OAuth client connected to an account: remembered consent, live
 * refresh tokens, or an active grant row. Newest first.
 */
export async function listOAuthGrants(userId: string): Promise<OAuthClientGrantDto[]> {
  const now = new Date();
  const [consents, refreshes, accesses, grants] = await Promise.all([
    db.select().from(oauthConsent).where(eq(oauthConsent.userId, userId)),
    db
      .select({
        clientId: oauthRefreshToken.clientId,
        scopes: oauthRefreshToken.scopes,
        createdAt: oauthRefreshToken.createdAt,
        expiresAt: oauthRefreshToken.expiresAt,
        revoked: oauthRefreshToken.revoked,
      })
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.userId, userId)),
    db
      .select({
        clientId: oauthAccessToken.clientId,
        scopes: oauthAccessToken.scopes,
        createdAt: oauthAccessToken.createdAt,
        expiresAt: oauthAccessToken.expiresAt,
      })
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.userId, userId)),
    db
      .select()
      .from(apiToken)
      .where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt)))
      .orderBy(desc(apiToken.createdAt)),
  ]);

  interface Entry {
    scopes: Set<string>;
    createdAt: Date | null;
    lastUsedAt: Date | null;
    tokenId: string | null;
  }
  const entries = new Map<string, Entry>();
  const entry = (clientId: string): Entry => {
    let found = entries.get(clientId);
    if (!found) {
      found = { scopes: new Set(), createdAt: null, lastUsedAt: null, tokenId: null };
      entries.set(clientId, found);
    }
    return found;
  };
  const earliest = (a: Date | null, b: Date | null | undefined) => (!b ? a : !a || b < a ? b : a);

  for (const consent of consents) {
    const item = entry(consent.clientId);
    for (const scope of parseScopes(consent.scopes)) item.scopes.add(scope);
    item.createdAt = earliest(item.createdAt, consent.createdAt);
  }
  for (const refresh of refreshes) {
    if (refresh.revoked || !refresh.expiresAt || refresh.expiresAt <= now) continue;
    const item = entry(refresh.clientId);
    for (const scope of parseScopes(refresh.scopes)) item.scopes.add(scope);
    item.createdAt = earliest(item.createdAt, refresh.createdAt);
  }
  for (const access of accesses) {
    if (!access.expiresAt || access.expiresAt <= now) continue;
    const item = entry(access.clientId);
    for (const scope of parseScopes(access.scopes)) item.scopes.add(scope);
    item.createdAt = earliest(item.createdAt, access.createdAt);
  }
  for (const grant of grants) {
    if (!grant.oauthClientId) continue;
    const item = entry(grant.oauthClientId);
    item.tokenId = grant.id;
    item.lastUsedAt = grant.lastUsedAt;
    item.createdAt = earliest(item.createdAt, grant.createdAt);
  }
  if (entries.size === 0) return [];

  const clients = await db
    .select()
    .from(oauthClient)
    .where(inArray(oauthClient.clientId, [...entries.keys()]));
  const byId = new Map(clients.map((client) => [client.clientId, client]));

  return [...entries.entries()]
    .map(([clientId, item]): OAuthClientGrantDto => {
      const client = byId.get(clientId);
      const scopes = [...item.scopes];
      return {
        clientId,
        name: client?.name?.trim() || "MCP client",
        // Rows registered before https validation may hold other schemes.
        iconUrl: httpsUrlOrNull(client?.icon),
        clientUri: httpsUrlOrNull(client?.uri),
        redirectHosts: redirectHostsOf(client?.redirectUris),
        scopes: apiScopesOf(scopes),
        offlineAccess: scopes.includes(OAUTH_OFFLINE_ACCESS_SCOPE),
        createdAt: (item.createdAt ?? client?.createdAt ?? now).toISOString(),
        lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
        tokenId: item.tokenId,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function httpsUrlOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** Client display names for `kind: "oauth"` token rows. */
export async function oauthClientNames(clientIds: string[]): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const rows = await db
    .select({ clientId: oauthClient.clientId, name: oauthClient.name })
    .from(oauthClient)
    .where(inArray(oauthClient.clientId, clientIds));
  return new Map(rows.map((row) => [row.clientId, row.name?.trim() || "MCP client"]));
}

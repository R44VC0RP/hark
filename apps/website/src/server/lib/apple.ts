import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { db } from "../db";
import { account, appleNativeGrant } from "../db/schema";
import { env } from "../env";
import { decryptAppleRefreshToken } from "./token";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_TOKEN_ENDPOINT = `${APPLE_ISSUER}/auth/token`;
const APPLE_REVOKE_ENDPOINT = `${APPLE_ISSUER}/auth/revoke`;
const APPLE_CLIENT_SECRET_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

export interface AppleAuthConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
}

export class AppleOAuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * Apple could not confirm a revocation (unreachable, 5xx, or a rejected
 * request). Account deletion stops and the user can retry later.
 */
export class AppleRevocationError extends Error {}

export function normalizeApplePrivateKey(value: string): string {
  const normalized = value.replace(/\\n/g, "\n").trim();
  if (normalized.includes("BEGIN PRIVATE KEY")) return normalized;
  const decoded = Buffer.from(normalized, "base64").toString("utf8").trim();
  if (!decoded.includes("BEGIN PRIVATE KEY")) {
    throw new Error("APPLE_SIGN_IN_PRIVATE_KEY must be a PEM key or base64-encoded PEM key");
  }
  return decoded;
}

/** Generates a short-lived client assertion instead of persisting a six-month secret. */
export async function generateAppleClientSecret(
  clientId: string,
  config: AppleAuthConfig,
  now = Math.floor(Date.now() / 1000),
  lifetimeSeconds = 5 * 60,
): Promise<string> {
  if (lifetimeSeconds < 1 || lifetimeSeconds > APPLE_CLIENT_SECRET_MAX_AGE_SECONDS) {
    throw new Error("Apple client secret lifetime must be between 1 second and 180 days");
  }
  const key = await importPKCS8(normalizeApplePrivateKey(config.privateKey), "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setSubject(clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(key);
}

export async function verifyAppleIdentityToken(
  token: string,
  expectedAudience: string,
  expectedSubject?: string,
): Promise<string> {
  const { payload } = await jwtVerify(token, appleJwks, {
    algorithms: ["RS256"],
    issuer: APPLE_ISSUER,
    audience: expectedAudience,
    maxTokenAge: "1h",
  });
  if (payload.aud !== expectedAudience || typeof payload.sub !== "string" || !payload.sub) {
    throw new AppleOAuthError("Apple identity token has invalid claims");
  }
  if (expectedSubject !== undefined && payload.sub !== expectedSubject) {
    throw new AppleOAuthError("Apple identity token subject does not match the signed-in account");
  }
  return payload.sub;
}

interface AppleTokenResponse {
  refreshToken: string;
  identityToken: string;
}

export async function exchangeAppleAuthorizationCode(
  code: string,
  clientId: string,
  expectedSubject: string,
  config: AppleAuthConfig,
): Promise<AppleTokenResponse> {
  const clientSecret = await generateAppleClientSecret(clientId, config);
  const response = await fetch(APPLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof body.error === "string" ? body.error : undefined;
    throw new AppleOAuthError("Apple rejected the authorization code", code);
  }
  if (typeof body.refresh_token !== "string" || typeof body.id_token !== "string") {
    throw new AppleOAuthError("Apple token response was incomplete");
  }
  await verifyAppleIdentityToken(body.id_token, clientId, expectedSubject);
  return { refreshToken: body.refresh_token, identityToken: body.id_token };
}

export async function revokeAppleToken(
  token: string,
  clientId: string,
  config: AppleAuthConfig,
): Promise<void> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: await generateAppleClientSecret(clientId, config),
    token,
    token_type_hint: "refresh_token",
  });
  let response: Response;
  try {
    response = await fetch(APPLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new AppleRevocationError(
      "Apple could not be reached to revoke Sign in with Apple. Try again in a few minutes.",
    );
  }
  if (response.ok) return;
  const error = ((await response.json().catch(() => ({}))) as Record<string, unknown>).error;
  // The grant is already gone (revoked by the user in Apple ID settings, or expired).
  if (error === "invalid_grant") return;
  throw new AppleRevocationError(
    `Apple token revocation failed with status ${response.status}. Try again in a few minutes.`,
  );
}

export function appleAuthConfig(): AppleAuthConfig {
  if (!env.APPLE_TEAM_ID || !env.APPLE_SIGN_IN_KEY_ID || !env.APPLE_SIGN_IN_PRIVATE_KEY) {
    throw new Error("Sign in with Apple server credentials are not configured");
  }
  return {
    teamId: env.APPLE_TEAM_ID,
    keyId: env.APPLE_SIGN_IN_KEY_ID,
    privateKey: env.APPLE_SIGN_IN_PRIVATE_KEY,
  };
}

export async function decryptBetterAuthOAuthToken(token: string): Promise<string> {
  const encrypted =
    token.startsWith("$ba$") || (token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token));
  if (!encrypted) return token;
  return symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: token });
}

/**
 * Revokes every Apple grant the user has. Account deletion is blocked (with an
 * {@link AppleRevocationError}) while Apple cannot confirm a revocation; a
 * linked Apple account with no stored token has nothing to revoke.
 */
export async function revokeAppleGrantsForUser(userId: string): Promise<void> {
  const [accounts, nativeGrants] = await Promise.all([
    db
      .select({ accountId: account.accountId, refreshToken: account.refreshToken })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "apple"))),
    db.select().from(appleNativeGrant).where(eq(appleNativeGrant.userId, userId)),
  ]);
  if (accounts.length === 0 && nativeGrants.length === 0) return;

  const grants: Array<{ token: string; clientId: string }> = [];
  for (const { refreshToken } of accounts) {
    if (!refreshToken) continue;
    if (!env.APPLE_SIGN_IN_SERVICE_ID) {
      throw new AppleRevocationError(
        "Apple authorization cannot be revoked because the Services ID is not configured.",
      );
    }
    grants.push({
      token: await decryptBetterAuthOAuthToken(refreshToken),
      clientId: env.APPLE_SIGN_IN_SERVICE_ID,
    });
  }
  grants.push(
    ...nativeGrants.map((grant) => ({
      token: decryptAppleRefreshToken(grant.refreshTokenCiphertext),
      clientId: grant.clientId,
    })),
  );
  const nativeSubjects = new Set(nativeGrants.map((grant) => grant.appleSubject));
  const accountWithoutRevocableGrant = accounts.some(
    ({ accountId, refreshToken }) => !refreshToken && !nativeSubjects.has(accountId),
  );
  if (accountWithoutRevocableGrant) {
    console.warn("[apple] Apple account has no stored refresh token; nothing to revoke for it");
  }
  if (grants.length === 0) return;

  let config: AppleAuthConfig;
  try {
    config = appleAuthConfig();
  } catch {
    throw new AppleRevocationError(
      "Apple authorization cannot be revoked because Sign in with Apple is not configured.",
    );
  }
  for (const grant of grants) {
    await revokeAppleToken(grant.token, grant.clientId, config);
  }
}

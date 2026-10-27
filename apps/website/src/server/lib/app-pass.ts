import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  APP_PASS_ALGORITHM,
  APP_PASS_JWT_TYPE,
  APP_PASS_TTL_SECONDS,
  type AppPassClaims,
  type TeamRole,
} from "@hark/contracts";
import { desc, isNull } from "drizzle-orm";
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";
import { db } from "../db";
import { appSigningKey } from "../db/schema";
import { env } from "../env";
import { decryptAppSigningKey, encryptAppSigningKey } from "./token";

/** Public signing key as published in the JWKS. */
export interface AppPassPublicJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid: string;
  alg: typeof APP_PASS_ALGORITHM;
  use: "sig";
}

interface ActiveSigningKey {
  kid: string;
  privateKey: CryptoKey | Uint8Array;
}

/**
 * Pass issuer, without a trailing slash. Web apps pin it, so production
 * keeps the original origin (APP_PASS_ISSUER) even after APP_URL moved.
 */
export function appPassIssuer(): string {
  return new URL(env.APP_PASS_ISSUER ?? env.APP_URL).origin;
}

function toPublicJwk(kid: string, jwk: JWK): AppPassPublicJwk {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new Error("Invalid Hark pass signing key");
  }
  return {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    kid,
    alg: APP_PASS_ALGORITHM,
    use: "sig",
  };
}

async function loadActiveKey(): Promise<ActiveSigningKey> {
  const [existing] = await db
    .select()
    .from(appSigningKey)
    .where(isNull(appSigningKey.retiredAt))
    .orderBy(desc(appSigningKey.createdAt))
    .limit(1);
  if (existing) {
    const privateJwk = JSON.parse(decryptAppSigningKey(existing.privateJwkCiphertext)) as JWK;
    return { kid: existing.id, privateKey: await importJWK(privateJwk, APP_PASS_ALGORITHM) };
  }

  const { privateKey, publicKey } = await generateKeyPair(APP_PASS_ALGORITHM, {
    extractable: true,
  });
  const kid = randomBytes(12).toString("base64url");
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = toPublicJwk(kid, await exportJWK(publicKey));
  await db.insert(appSigningKey).values({
    id: kid,
    algorithm: APP_PASS_ALGORITHM,
    publicJwk: JSON.stringify(publicJwk),
    privateJwkCiphertext: encryptAppSigningKey(JSON.stringify(privateJwk)),
    createdAt: new Date(),
  });
  return { kid, privateKey };
}

// One in-flight promise so concurrent first requests never mint two keys.
let activeKey: Promise<ActiveSigningKey> | undefined;
function getActiveKey(): Promise<ActiveSigningKey> {
  if (!activeKey) {
    activeKey = loadActiveKey().catch((error: unknown) => {
      activeKey = undefined;
      throw error;
    });
  }
  return activeKey;
}

/** Non-retired public keys. Creates the first key so the JWKS is never empty. */
export async function publicJwks(): Promise<{ keys: AppPassPublicJwk[] }> {
  await getActiveKey();
  const rows = await db
    .select({ publicJwk: appSigningKey.publicJwk })
    .from(appSigningKey)
    .where(isNull(appSigningKey.retiredAt))
    .orderBy(desc(appSigningKey.createdAt));
  return { keys: rows.map((row) => JSON.parse(row.publicJwk) as AppPassPublicJwk) };
}

function subjectKey(): Buffer {
  return createHash("sha256")
    .update("hark:app-pass-subject:v1\0", "utf8")
    .update(env.BETTER_AUTH_SECRET, "utf8")
    .digest();
}

/**
 * Pairwise subject: stable for one user at one origin, unlinkable across
 * origins, and never derived from the user's raw account ID alone.
 */
export function pairwiseSubject(userId: string, origin: string): string {
  const mac = createHmac("sha256", subjectKey())
    .update(`${userId}\0${origin}`, "utf8")
    .digest("base64url");
  return `hk_${mac}`.slice(0, 32);
}

export interface IssueAppPassInput {
  user: { id: string; name: string; email: string };
  app: { id: string; origin: string; shareName: boolean; shareEmail: boolean };
  /** For team apps: the team and the viewer's current role in it. */
  team?: { id: string; role: TeamRole };
}

export async function issueAppPass(
  input: IssueAppPassInput,
): Promise<{ token: string; expiresAt: Date; claims: AppPassClaims }> {
  const { kid, privateKey } = await getActiveKey();
  const iat = Math.floor(Date.now() / 1000);
  const claims: AppPassClaims = {
    iss: appPassIssuer(),
    aud: input.app.origin,
    sub: pairwiseSubject(input.user.id, input.app.origin),
    iat,
    exp: iat + APP_PASS_TTL_SECONDS,
    jti: randomBytes(16).toString("base64url"),
    app_id: input.app.id,
    ...(input.app.shareName && input.user.name ? { name: input.user.name } : {}),
    ...(input.app.shareEmail && input.user.email ? { email: input.user.email } : {}),
    ...(input.team ? { team_id: input.team.id, team_role: input.team.role } : {}),
  };
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: APP_PASS_ALGORITHM, kid, typ: APP_PASS_JWT_TYPE })
    .sign(privateKey);
  return { token, expiresAt: new Date(claims.exp * 1000), claims };
}

import { expo } from "@better-auth/expo";
import { oauthProvider } from "@better-auth/oauth-provider";
import { OAUTH_SCOPES, sanitizeDisplayText, USER_NAME_MAX_CHARS } from "@hark/contracts";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db } from "./db";
import * as schema from "./db/schema";
import { env } from "./env";
import {
  AppleRevocationError,
  appleAuthConfig,
  generateAppleClientSecret,
  revokeAppleGrantsForUser,
} from "./lib/apple";
import {
  clientDefaultScopes,
  hashOAuthToken,
  mcpResourceUrls,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_CONSENT_PAGE,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
} from "./lib/oauth";
import { publicOrigins } from "./lib/origins";
import { releaseTeamsOf } from "./lib/teams";

/**
 * A client that asks for no scope gets every scope except `tokens:manage`
 * (narrowed to what it registered for) instead of everything it may request.
 */
const oauthDefaultScopes = {
  id: "hark-oauth-default-scopes",
  hooks: {
    before: [
      {
        matcher: (ctx) =>
          ctx.path === "/oauth2/authorize" &&
          typeof ctx.query?.client_id === "string" &&
          !(typeof ctx.query.scope === "string" && ctx.query.scope.trim()),
        handler: createAuthMiddleware(async (ctx) => {
          const scope = (await clientDefaultScopes(String(ctx.query?.client_id))).join(" ");
          return scope ? { context: { query: { ...ctx.query, scope } } } : undefined;
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;

const CLIENT_METADATA_URIS = ["client_uri", "logo_uri", "tos_uri", "policy_uri"] as const;

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Dynamic registration is unauthenticated and the consent page and dashboard
 * show what a client registers, so bound its name and contacts and keep only
 * https links (a `javascript:` or `http:` URI is dropped rather than stored).
 */
const oauthClientMetadataLimits = {
  id: "hark-oauth-client-metadata-limits",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/oauth2/register",
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as Record<string, unknown> | undefined;
          if (!body || typeof body !== "object") return;
          if (typeof body.client_name === "string" && body.client_name.length > 100) {
            throw new APIError("BAD_REQUEST", {
              error: "invalid_client_metadata",
              error_description: "client_name must be at most 100 characters",
            });
          }
          if (Array.isArray(body.contacts) && body.contacts.length > 5) {
            throw new APIError("BAD_REQUEST", {
              error: "invalid_client_metadata",
              error_description: "contacts must list at most 5 entries",
            });
          }
          // In place: a returned context is merged with defu, which would restore
          // deleted keys from the original body.
          for (const key of CLIENT_METADATA_URIS) {
            if (key in body && !isHttpsUrl(body[key])) delete body[key];
          }
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;

const USER_IMAGE_MAX_CHARS = 2048;

/**
 * Names and avatars set through `/update-user` are shown to teammates, in
 * invite previews and push titles: keep names short, single-line and free of
 * invisible or reordering characters, and images https only.
 */
const userProfileLimits = {
  id: "hark-user-profile-limits",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/update-user",
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as Record<string, unknown> | undefined;
          if (!body || typeof body !== "object") return;
          if ("name" in body) {
            const name = typeof body.name === "string" ? sanitizeDisplayText(body.name) : "";
            if (name.length < 1 || name.length > USER_NAME_MAX_CHARS) {
              throw new APIError("BAD_REQUEST", {
                message: `name must be 1 to ${USER_NAME_MAX_CHARS} characters`,
              });
            }
            body.name = name;
          }
          if ("image" in body && body.image !== null) {
            if (
              typeof body.image !== "string" ||
              body.image.length > USER_IMAGE_MAX_CHARS ||
              !isHttpsUrl(body.image)
            ) {
              throw new APIError("BAD_REQUEST", {
                message: `image must be an https URL of at most ${USER_IMAGE_MAX_CHARS} characters, or null`,
              });
            }
          }
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;

const APPLE_ORIGIN = "https://appleid.apple.com";
const STATIC_TRUSTED_ORIGINS = [...publicOrigins(), "hark://", "hark://*"];

/** Apple's cross-site form POST is trusted only on its own OAuth callback. */
function trustedOrigins(request?: Request): string[] {
  if (!request) return STATIC_TRUSTED_ORIGINS;
  try {
    if (new URL(request.url).pathname === "/api/auth/callback/apple") {
      return [...STATIC_TRUSTED_ORIGINS, APPLE_ORIGIN];
    }
  } catch {}
  return STATIC_TRUSTED_ORIGINS;
}

/**
 * Runs before Better Auth deletes an account: revoke Apple grants first (the
 * step that can fail), then hand over or delete the user's teams.
 */
async function beforeDeleteUser(userId: string): Promise<void> {
  try {
    await revokeAppleGrantsForUser(userId);
  } catch (error) {
    if (error instanceof AppleRevocationError) {
      throw new APIError("CONFLICT", {
        message: `Your account was not deleted. ${error.message}`,
      });
    }
    throw error;
  }
  await releaseTeamsOf(userId);
}

export const auth = betterAuth({
  appName: "Hark",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  account: {
    encryptOAuthTokens: true,
  },
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => beforeDeleteUser(user.id),
    },
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      disableDefaultScope: true,
      scope: ["openid", "email", "profile"],
    },
    apple: async () => {
      const clientId = env.APPLE_SIGN_IN_SERVICE_ID ?? "";
      const configured =
        clientId && env.APPLE_TEAM_ID && env.APPLE_SIGN_IN_KEY_ID && env.APPLE_SIGN_IN_PRIVATE_KEY;
      return {
        clientId,
        clientSecret: configured
          ? await generateAppleClientSecret(
              clientId,
              appleAuthConfig(),
              undefined,
              180 * 24 * 60 * 60,
            )
          : "",
        appBundleIdentifier: env.APPLE_SIGN_IN_BUNDLE_ID,
        // Better Auth 1.6.25's appBundleIdentifier alone replaces the web audience;
        // audience explicitly accepts both the Services ID and native App ID.
        audience: [clientId, env.APPLE_SIGN_IN_BUNDLE_ID],
      };
    },
  },
  plugins: [
    expo(),
    // OAuth 2.1 authorization server for the remote MCP server at /mcp.
    oauthProvider({
      loginPage: OAUTH_CONSENT_PAGE,
      consentPage: OAUTH_CONSENT_PAGE,
      scopes: [...OAUTH_SCOPES],
      // Tokens are only ever issued for the MCP server.
      // The MCP URL on every public origin, so clients set up on an earlier
      // domain keep refreshing their tokens.
      validAudiences: mcpResourceUrls(),
      grantTypes: ["authorization_code", "refresh_token"],
      // MCP clients (Claude, OpenCode, Cursor, …) register themselves as public
      // PKCE clients; registration never grants anything without consent.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      allowPublicClientPrelogin: true,
      // Opaque, hashed, database-backed tokens so revocation is immediate.
      disableJwtPlugin: true,
      storeTokens: { hash: async (token) => hashOAuthToken(token) },
      prefix: {
        opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
        refreshToken: OAUTH_REFRESH_TOKEN_PREFIX,
      },
      accessTokenExpiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      // Served at the origin root by routes/oauth.ts.
      silenceWarnings: { oauthAuthServerConfig: true },
    }),
    oauthDefaultScopes,
    oauthClientMetadataLimits,
    userProfileLimits,
  ],
  trustedOrigins,
  advanced: {
    // Rate limits (e.g. OAuth client registration) key on the client IP. Only a
    // header the trusted edge overwrites is used; forwarded headers sent by the
    // client itself are spoofable, so without one no header is read at all
    // (Better Auth would otherwise default to X-Forwarded-For).
    ipAddress: {
      ipAddressHeaders: env.TRUSTED_CLIENT_IP_HEADER ? [env.TRUSTED_CLIENT_IP_HEADER] : [],
    },
    ...(env.APP_URL.startsWith("https://")
      ? {
          // Apple returns OAuth callbacks with a cross-site form POST. Better Auth
          // 1.6.25 still requires its signed state cookie on that request.
          cookies: {
            state: { attributes: { sameSite: "none" as const, secure: true } },
          },
        }
      : {}),
  },
});

export type Session = typeof auth.$Infer.Session;

import { expo } from "@better-auth/expo";
import { oauthProvider } from "@better-auth/oauth-provider";
import { OAUTH_SCOPES } from "@hark/contracts";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db } from "./db";
import * as schema from "./db/schema";
import { env } from "./env";
import { appleAuthConfig, generateAppleClientSecret, revokeAppleGrantsForUser } from "./lib/apple";
import {
  clientDefaultScopes,
  hashOAuthToken,
  mcpResourceUrl,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_CONSENT_PAGE,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
} from "./lib/oauth";

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
      beforeDelete: async (user) => revokeAppleGrantsForUser(user.id),
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
      validAudiences: [mcpResourceUrl()],
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
  ],
  trustedOrigins: [env.APP_URL, "https://appleid.apple.com", "hark://", "hark://*"],
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

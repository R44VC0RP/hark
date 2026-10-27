import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { MCP_PATH, type OAuthClientGrantListResponse } from "@hark/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "../auth";
import { listOAuthGrants, protectedResourceMetadata, revokeOAuthGrant } from "../lib/oauth";
import { requestOrigin } from "../lib/origins";
import { type AuthedEnv, requireAuth } from "../middleware";

const METADATA_CACHE_CONTROL =
  "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400";

let authServerMetadataHandler: ((request: Request) => Promise<Response>) | undefined;

/**
 * OAuth discovery documents at the origin root, where MCP clients look:
 *
 * - RFC 9728 protected resource metadata for `/mcp`, at both the
 *   path-inserted URL `/mcp`'s 401 challenge points to and the bare root.
 * - RFC 8414 authorization server metadata for the issuer
 *   (`<origin>/api/auth`), path-inserted and at the root for clients that
 *   only probe the origin.
 *
 * Mounted ahead of the static handler so `dist/client` can never shadow it.
 */
export const oauthWellKnownRoute = new Hono()
  // Browser-based MCP clients read discovery documents cross-origin.
  // Explicit allowHeaders so the preflight never parses Access-Control-Request-Headers.
  .use(
    "/.well-known/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "HEAD", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "mcp-protocol-version"],
    }),
  )
  .get("/.well-known/oauth-protected-resource", (c) => {
    c.header("Cache-Control", METADATA_CACHE_CONTROL);
    return c.json(protectedResourceMetadata(requestOrigin(c.req.url)));
  })
  .get(`/.well-known/oauth-protected-resource${MCP_PATH}`, (c) => {
    c.header("Cache-Control", METADATA_CACHE_CONTROL);
    return c.json(protectedResourceMetadata(requestOrigin(c.req.url)));
  })
  .get("/.well-known/oauth-authorization-server", (c) => authServerMetadata(c.req.raw))
  .get("/.well-known/oauth-authorization-server/api/auth", (c) => authServerMetadata(c.req.raw));

function authServerMetadata(request: Request): Promise<Response> {
  authServerMetadataHandler ??= oauthProviderAuthServerMetadata(auth);
  return authServerMetadataHandler(request);
}

/**
 * Session API for the dashboard's "Connected MCP clients" list, mounted at
 * `/api/oauth`. Revoking deletes the client's access and refresh tokens and
 * its remembered consent, so it must ask again to reconnect.
 */
export const oauthClientsRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/clients", async (c) => {
    const body: OAuthClientGrantListResponse = {
      clients: await listOAuthGrants(c.get("user").id),
    };
    return c.json(body);
  })
  .delete("/clients/:clientId", (c) => {
    const revoked = revokeOAuthGrant(c.get("user").id, c.req.param("clientId"), "dashboard");
    if (!revoked) return c.json({ error: "Connected client not found" }, 404);
    return c.json({ ok: true });
  });

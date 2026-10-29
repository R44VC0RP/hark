import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { and, isNotNull, lt, or, sql } from "drizzle-orm";
import { app, setNotFoundPage } from "./app";
import { db, sqlite } from "./db";
import { runMigrations } from "./db/migrate";
import { analyticsEvent, session, teamInvite, verification } from "./db/schema";
import { assertRuntimeEnv, env } from "./env";
import { pruneAnalytics } from "./lib/analytics";
import { startInteractionCallbackWorker } from "./lib/interaction-callbacks";
import { startOncallEscalationWorker } from "./lib/oncall";

const CLOSED_INVITE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Daily hygiene: expired auth rows Better Auth never removes, invites (and their
 * e-mail addresses) a month after they closed, and analytics links to deleted users.
 */
function sweepExpiredRows(): void {
  try {
    const now = new Date();
    const closedBefore = new Date(now.getTime() - CLOSED_INVITE_RETENTION_MS);
    db.delete(verification).where(lt(verification.expiresAt, now)).run();
    db.delete(session).where(lt(session.expiresAt, now)).run();
    db.delete(teamInvite)
      .where(
        or(
          lt(teamInvite.acceptedAt, closedBefore),
          lt(teamInvite.revokedAt, closedBefore),
          lt(teamInvite.expiresAt, closedBefore),
        ),
      )
      .run();
    db.update(analyticsEvent)
      .set({ userId: null })
      .where(
        and(
          isNotNull(analyticsEvent.userId),
          sql`not exists (select 1 from "user" where "user"."id" = ${analyticsEvent.userId})`,
        ),
      )
      .run();
    // `user_id` is part of the per-day unique key, so the row keeps counting
    // toward that day's actives under an unlinkable id.
    sqlite
      .prepare(
        `update analytics_user_day set user_id = 'deleted_' || lower(hex(randomblob(12)))
         where substr(user_id, 1, 8) <> 'deleted_'
           and not exists (select 1 from "user" where "user"."id" = analytics_user_day.user_id)`,
      )
      .run();
  } catch (error) {
    console.error("Failed to sweep expired rows", error);
  }
}

assertRuntimeEnv();
runMigrations();
// Bounds the analytics log at startup; long-running processes prune opportunistically.
pruneAnalytics();
sweepExpiredRows();
setInterval(sweepExpiredRows, 24 * 60 * 60 * 1000).unref();
startInteractionCallbackWorker();
startOncallEscalationWorker();

// In production the same process serves prerendered public pages and explicit
// noindex shells for private application routes. Unknown paths remain real 404s
// instead of becoming indexable soft-404 copies of the home page.
const clientDir = resolve(process.cwd(), "dist/client");
if (existsSync(clientDir)) {
  // HTML shells must revalidate so a deploy's new asset hashes are picked up;
  // Vite's content-hashed /assets/* never change and can be cached for good.
  const shell = (path: string) =>
    serveStatic({ path, onFound: (_path, c) => c.header("Cache-Control", "no-cache") });
  const documentRoutes = [
    "/",
    "/docs",
    "/pricing",
    "/a/launched",
    "/privacy",
    "/terms",
    "/dashboard",
  ];
  for (const path of documentRoutes) {
    const file = path === "/" ? "index.html" : `${path.slice(1)}/index.html`;
    if (existsSync(resolve(clientDir, file))) {
      app.get(path, shell(`./dist/client/${file}`));
    }
  }
  // Client-routed private pages reuse the noindex dashboard shell.
  if (existsSync(resolve(clientDir, "dashboard/index.html"))) {
    // `/join` without a code shows the invite page's invalid-link state.
    const privateRoutes = [
      "/dashboard/notifications",
      "/dashboard/agents",
      "/dashboard/apps",
      "/dashboard/teams",
      "/dashboard/teams/:teamId",
      "/dashboard/devices",
      "/dashboard/billing",
      "/join",
      "/join/:code",
      "/oauth/consent",
    ];
    for (const path of privateRoutes) {
      app.get(path, shell("./dist/client/dashboard/index.html"));
    }
  }
  if (existsSync(resolve(clientDir, "cli/authorize/index.html"))) {
    app.get("/cli/authorize", shell("./dist/client/cli/authorize/index.html"));
  }
  // Unknown pages get the styled, noindex "page not found" document with a 404
  // status. It lives outside dist/client so it is never served with a 200.
  const notFoundPath = resolve(clientDir, "../404.html");
  if (existsSync(notFoundPath)) setNotFoundPage(readFileSync(notFoundPath, "utf8"));
  app.use(
    "*",
    serveStatic({
      root: "./dist/client",
      onFound: (path, c) => {
        if (c.req.path.startsWith("/assets/")) {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        } else if (path.endsWith(".html")) {
          c.header("Cache-Control", "no-cache");
        }
      },
    }),
  );
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Hark API listening on http://localhost:${info.port} (${env.NODE_ENV})`);
  if (!existsSync(clientDir)) {
    console.log("No dist/client build found — expecting the Vite dev server to proxy /api.");
  }
});

/**
 * WAL data only lands in the main database file on a clean close. Without this,
 * `hark.sqlite` stays stale and any file-level backup of it is effectively empty.
 */
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, checkpointing SQLite and shutting down.`);
  server.close(() => {
    try {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
      sqlite.close();
    } catch (error) {
      console.error("Failed to checkpoint SQLite on shutdown", error);
    }
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

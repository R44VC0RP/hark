# syntax=docker/dockerfile:1

# Pinned by digest; bump deliberately (docker buildx imagetools inspect node:22-trixie-slim).
FROM node:22-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ---------------------------------------------------------------------------
# Build: install workspace deps, build the SPA and bundle the Hono server.
# ---------------------------------------------------------------------------
FROM base AS build
# Toolchain for better-sqlite3 when no prebuilt binary matches this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/website/package.json apps/website/
COPY packages/contracts/package.json packages/contracts/
COPY packages/website-runtime/package.json packages/website-runtime/
RUN pnpm install --frozen-lockfile --filter hark --filter @hark/website --filter @hark/contracts --filter @hark/website-runtime
COPY packages ./packages
COPY apps/website ./apps/website
RUN pnpm --filter @hark/website build
# Legacy deploy switches the workspace to production-only, so it must run after compilation.
RUN pnpm --filter @hark/website-runtime deploy --prod --legacy /out

# ---------------------------------------------------------------------------
# Runtime: single process serving the API and the static SPA.
# SQLite persists under /data (mount a volume there).
# ---------------------------------------------------------------------------
FROM node:22-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS runtime
ENV NODE_ENV=production
ENV PORT=8787
ENV DATABASE_URL=/data/hark.sqlite
# The pinned base can lag Debian security fixes (glibc, zlib, ...); take them at build time.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The app is root-owned and read-only so the runtime user cannot rewrite it;
# only /data is writable by node.
COPY --from=build --chown=root:root /out/node_modules ./node_modules
COPY --from=build --chown=root:root /repo/apps/website/dist ./dist
COPY --from=build --chown=root:root /repo/apps/website/drizzle ./drizzle
# Read-only operator scripts, e.g. `node scripts/analytics.mjs summary`.
COPY --from=build --chown=root:root /repo/apps/website/scripts ./scripts
COPY --from=build --chown=root:root /out/package.json ./package.json
RUN chmod -R a-w node_modules dist drizzle scripts package.json \
  && mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run inside the server process before it starts listening.
CMD ["node", "dist/server/index.js"]

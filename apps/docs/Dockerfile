# Production image for apps/docs (murasaki-docs), built as a Next.js
# "standalone" server for Dokploy/any VPS (see next.config.mjs's
# `output: "standalone"`).
#
# IMPORTANT — build context MUST be the monorepo root, not apps/docs/,
# because `pnpm install` needs to see pnpm-workspace.yaml and every
# workspace package's package.json to resolve the workspace graph, even
# though this image only builds & serves `murasaki-docs`:
#
#   docker build -f apps/docs/Dockerfile -t murasaki-docs .
#   docker run -p 3000:3000 murasaki-docs
#
# See ../../.dockerignore (repo root — not this directory; Docker doesn't
# honor a `.dockerignore` located next to a non-root-level Dockerfile) for
# what's excluded from the build context.

FROM node:24-slim AS base
RUN corepack enable

# -----------------------------------------------------------------------
# deps + build
# -----------------------------------------------------------------------
FROM base AS builder
WORKDIR /repo

# The whole monorepo (trimmed by .dockerignore: no node_modules, no Rust
# `target/`, no stale `.next`/`out`). Not split into a separate
# manifests-first layer for `pnpm install` caching — this keeps the
# Dockerfile simple and correct as workspace packages are added/removed,
# at the cost of reinstalling on every source change rather than just
# dependency changes.
COPY . .

RUN corepack prepare pnpm@9.15.0 --activate \
  && pnpm install --frozen-lockfile

# `NEXT_PUBLIC_*` vars are inlined by Next at BUILD time, so they must be
# present when `next build` runs — a runtime env var is too late. Dokploy
# passes this via its "Build-time Arguments" (a Docker `--build-arg`); when
# unset the app's `metadataBase` keeps its env fallback (see app/layout.tsx).
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}

RUN pnpm --filter murasaki-docs build

# -----------------------------------------------------------------------
# runtime
# -----------------------------------------------------------------------
FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin nextjs

# `output: "standalone"` traces the minimal `node_modules` subset this
# server needs into `.next/standalone` (alongside a `server.js` entrypoint),
# mirroring the app's path inside the workspace (`apps/docs/...`) because
# `outputFileTracingRoot` is pinned to the monorepo root in next.config.mjs.
# `public/` and `.next/static` are deliberately NOT part of `standalone`
# (a documented Next.js caveat) and must be copied in separately.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/docs/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/docs/.next/static ./apps/docs/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/docs/public ./apps/docs/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/docs/server.js"]

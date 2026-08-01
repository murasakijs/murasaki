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

# Build the workspace packages the docs imports at build time. The component
# docs render `@murasakijs/ui` live, but its `dist/` is gitignored (absent from
# the repo clone) and `pnpm install` does NOT build workspace packages — so
# build it explicitly here, or `next build` fails to resolve `@murasakijs/ui`.
RUN pnpm --filter @murasakijs/ui build

# Deployed site URL. `NEXT_PUBLIC_*` vars are inlined by Next at BUILD time,
# so this must be present when `next build` runs. The portable, host-agnostic
# way to inject it is a build arg:
#   docker build --build-arg NEXT_PUBLIC_SITE_URL=https://example.com ...
# When the arg is omitted we `unset` it before building so an EMPTY value
# can't clobber one provided another way (e.g. apps/docs/.env, which Dokploy's
# "Create Environment File" writes and `next build` auto-loads); lib/seo.ts
# falls back to the production origin if it ends up absent. Do NOT turn this
# into a bare `ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}` — an unset arg
# would then hard-set it to "" and `new URL("")` fails the build.
ARG NEXT_PUBLIC_SITE_URL
RUN if [ -z "$NEXT_PUBLIC_SITE_URL" ]; then unset NEXT_PUBLIC_SITE_URL; fi; \
    pnpm --filter murasaki-docs build

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

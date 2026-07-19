FROM node:24-alpine AS dependencies
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY docker/package.json ./package.json
COPY docker/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm exec murasaki build

FROM node:24-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
  && addgroup -S orglia && adduser -S -G orglia -h /app orglia
WORKDIR /app
ENV NODE_ENV=production PORT=4173 CLIENT_DIR=/app/dist/client SQLITE_PATH=/app/data/orglia.db
COPY docker/package.json ./package.json
COPY docker/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=build --chown=orglia:orglia /app/dist/client ./dist/client
COPY --chown=orglia:orglia server ./server
RUN mkdir -p /app/data && chown -R orglia:orglia /app
USER orglia
VOLUME ["/app/data"]
EXPOSE 4173
CMD ["node", "server/server.mjs"]

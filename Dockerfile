# syntax=docker/dockerfile:1

FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/sync-client/package.json ./packages/sync-client/package.json
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.client.config.ts vite.server.config.ts index.html ./
COPY packages ./packages
COPY src ./src
COPY public ./public

RUN npm run build:docker

FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache su-exec

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    KUROSYNC_DATA_DIR=/data \
    KUROSYNC_DB_PATH=/data/kurosync.db \
    KUROSYNC_STATIC_DIR=/app/dist/client \
    KUROSYNC_MIGRATIONS_DIR=/app/migrations \
    TRUST_PROXY=true

COPY --from=builder /app/dist/client ./dist/client
COPY --from=builder /app/dist/server ./dist/server
COPY migrations ./migrations
COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>r.json()).then(d=>process.exit(d&&d.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "/app/dist/server/index.mjs"]

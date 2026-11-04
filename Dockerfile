FROM node:22-slim AS builder
WORKDIR /app
# Build tools so better-sqlite3 can compile if no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The webpack cache only speeds up the next build here, so it stays out of the image.
RUN npm run build && rm -rf .next/cache

FROM node:22-slim
WORKDIR /app
# The backup/restore utility uses Python's standard-library SQLite backup API.
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=3000
ENV PLATFORM_MODE=legacy
ENV DATABASE_PATH=/app/.data/bangla-adventures.db
ENV MEDIA_ROOT=/app/.data/media
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/db ./db
# Server commands such as admin:grant load the database code, which reads app/ sources.
COPY --from=builder /app/app ./app
COPY --from=builder /app/scripts/grant-admin.ts /app/scripts/reset-password.ts ./scripts/
COPY --from=builder /app/scripts/backup_restore.py /app/scripts/backup.sh /app/scripts/restore.sh /app/scripts/docker-start.sh ./scripts/
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Persistent state (SQLite database + uploaded audio) lives in /app/.data: mount a volume
# there in production. The image declares no volume itself, as some hosts (Railway) refuse that.
# The app runs as `node`; scripts/docker-start.sh switches to it when a host starts the
# container as root to hand over a root-owned disk (compose.yaml starts it as `node` directly).
# The writable folders also belong to group 0 with the owner's rights, so hosts that run the
# container under an arbitrary uid in group 0 (OpenShift) can write them too.
RUN mkdir -p .data/media .next/cache && chown -R node:0 .data .next/cache \
  && chmod -R g=u .data .next/cache && chmod 0755 scripts/docker-start.sh

EXPOSE 3000

# Container-level liveness probe hitting the app's health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["scripts/docker-start.sh"]
# Next runs directly, not through npm, so it receives SIGTERM and lets open requests finish.
# Idle connections are kept open longer than load balancers keep theirs (up to 600 s), so the
# app never closes a connection that a load balancer is about to reuse (which shows as a 502).
CMD ["node", "node_modules/next/dist/bin/next", "start", "--keepAliveTimeout", "620000"]

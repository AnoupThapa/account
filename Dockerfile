# LedgerPro — one Dockerfile, three runtime targets: api, worker, web
# Build:  docker build --target api -t ledgerpro-api .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Next.js bakes the API address into its rewrites at build time
ENV API_INTERNAL_URL=http://api:4000
RUN pnpm --filter @ledgerpro/shared build && pnpm --filter @ledgerpro/db build \
 && pnpm --filter @ledgerpro/api build && pnpm --filter @ledgerpro/worker build \
 && pnpm --filter @ledgerpro/web build
RUN pnpm deploy --filter @ledgerpro/api --prod --legacy /out/api && cp -r apps/api/dist /out/api/dist \
 && pnpm deploy --filter @ledgerpro/worker --prod --legacy /out/worker && cp -r apps/worker/dist /out/worker/dist \
 && pnpm deploy --filter @ledgerpro/db --prod --legacy /out/db && cp -r packages/db/dist /out/db/dist && cp -r packages/db/migrations /out/db/migrations

# Database migrations (runs once on deploy as the schema owner)
FROM node:22-bookworm-slim AS migrate
WORKDIR /app
COPY --from=build /out/db /app
USER node
CMD ["node", "-e", "require('./dist').runMigrations(process.env.DATABASE_ADMIN_URL).then(()=>require('./dist').seedGlobal(process.env.DATABASE_ADMIN_URL)).then(()=>console.log('migrations done')).catch(e=>{console.error(e.message);process.exit(1)})"]

# API (includes Chromium for invoice PDFs)
FROM node:22-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-noto-ui-core && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=build /out/api /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM node:22-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/worker /app
USER node
CMD ["node", "dist/main.js"]

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

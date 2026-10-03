# Keeper image for Railway. Build context = repo root (workspace packages are needed).
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/db/package.json packages/db/
COPY indexer/package.json indexer/
RUN pnpm install --frozen-lockfile --filter @satpad/indexer... 
COPY packages/sdk packages/sdk
COPY packages/db packages/db
COPY indexer indexer
COPY idl-ref idl-ref
ENV NODE_ENV=production
EXPOSE 8082
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||8082)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@satpad/indexer", "start"]

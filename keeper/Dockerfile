# Keeper image for Railway. Build context = repo root (workspace packages are needed).
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/db/package.json packages/db/
COPY keeper/package.json keeper/
RUN pnpm install --frozen-lockfile --filter @satpad/keeper... 
COPY packages/sdk packages/sdk
COPY packages/db packages/db
COPY keeper keeper
COPY idl-ref idl-ref
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@satpad/keeper", "start"]

# Build context is the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @pos/api...
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
COPY db db
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@pos/api", "start"]

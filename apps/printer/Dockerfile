# Build context is the repo root: docker build -f apps/printer/Dockerfile .
FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/printer/package.json apps/printer/
RUN pnpm install --frozen-lockfile --filter @pos/printer...
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/printer apps/printer
COPY db db
ENV NODE_ENV=production
EXPOSE 3100
CMD ["pnpm", "--filter", "@pos/printer", "start"]

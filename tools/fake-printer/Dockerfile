# Build context is the repo root: docker build -f tools/fake-printer/Dockerfile .
FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY tools/fake-printer/package.json tools/fake-printer/
RUN pnpm install --frozen-lockfile --filter @pos/fake-printer...
COPY tools/fake-printer tools/fake-printer
ENV FAKE_PRINTER_OUTPUT=/output
EXPOSE 9100
CMD ["pnpm", "--filter", "@pos/fake-printer", "start"]

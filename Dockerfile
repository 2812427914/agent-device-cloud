FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY tests ./tests
COPY scripts ./scripts
COPY deploy ./deploy
RUN pnpm install --frozen-lockfile
RUN pnpm schema:check && pnpm exec tsc --noEmit && pnpm --filter @adc/console build
RUN pnpm build:node

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app /app
USER node
EXPOSE 8787
CMD ["node", "--import", "tsx", "apps/control-plane/src/main.ts"]

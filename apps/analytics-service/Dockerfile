# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/analytics-service ./apps/analytics-service
RUN pnpm install --frozen-lockfile --filter=analytics-service...

FROM deps AS build
RUN pnpm --filter=analytics-service build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/analytics-service/dist ./dist
COPY --from=build /repo/apps/analytics-service/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 4008
CMD ["node", "dist/main.js"]

# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/order-service ./apps/order-service
RUN pnpm install --frozen-lockfile --filter=order-service...

FROM deps AS build
RUN pnpm --filter=order-service build

FROM node:22-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/order-service/dist ./dist
COPY --from=build /repo/apps/order-service/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 4004
CMD ["node", "dist/main.js"]

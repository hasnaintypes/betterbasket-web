# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/payment-service ./apps/payment-service
RUN pnpm install --frozen-lockfile --filter=payment-service...

FROM deps AS build
RUN pnpm --filter=payment-service build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/payment-service/dist ./dist
COPY --from=build /repo/apps/payment-service/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 4005
CMD ["node", "dist/main.js"]

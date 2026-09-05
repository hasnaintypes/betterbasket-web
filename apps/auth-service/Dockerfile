# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/auth-service ./apps/auth-service
RUN pnpm install --frozen-lockfile --filter=auth-service...

FROM deps AS build
RUN pnpm --filter=auth-service build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/auth-service/dist ./dist
COPY --from=build /repo/apps/auth-service/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 4001
CMD ["node", "dist/main.js"]

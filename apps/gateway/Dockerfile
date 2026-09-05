# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/gateway ./apps/gateway
RUN pnpm install --frozen-lockfile --filter=gateway...

FROM deps AS build
RUN pnpm --filter=gateway build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/gateway/dist ./dist
COPY --from=build /repo/apps/gateway/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 4000
CMD ["node", "dist/main.js"]

# ADR 0001: Turborepo monorepo, pnpm workspaces

## Status
Accepted

## Context
BetterBasket ships 3 frontends and 9+ backend services that must share
types/DTOs, UI components, and tooling config, while still deploying
independently (see ADR 0006).

## Decision
- Single repo, pnpm workspaces (`apps/*`, `packages/*`), Turborepo as the
  task runner.
- Shared code lives in `packages/*` (contracts, ui, config, kafka-client,
  auth-shared, logger, utils) and is consumed via `workspace:*` deps.
- CI/deploys use Turborepo's affected-package filtering
  (`turbo run build --filter=...[origin/main]`) so a change to one service
  doesn't rebuild/redeploy the other eleven.

## Consequences
- One `pnpm install` for the whole repo; one lockfile.
- Non-JS services (e.g. the deferred `recommendation-service`, Python/FastAPI)
  live in `apps/` too but sit outside Turborepo's JS task graph — they're
  just a folder with their own tooling, invoked directly in CI.

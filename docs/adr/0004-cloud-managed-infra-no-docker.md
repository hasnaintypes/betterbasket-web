# ADR 0004: Cloud-managed infra for every environment, no local Docker

## Status
Accepted (supersedes the original plan to use `docker-compose` for local dev)

## Context
Docker Desktop on Windows adds real friction (WSL2 setup, resource usage,
occasional networking issues) for local development, and running Postgres +
MongoDB + Redis + a Kafka broker locally is exactly the kind of
infrastructure a solo/small team shouldn't have to babysit.

## Decision
There is no local datastore/broker at all, in *any* environment. Every
service always talks to a real managed cloud service:

| Concern | Provider | Local (dev) | Prod |
|---|---|---|---|
| Postgres | Neon | `dev` branch | `prod` branch |
| MongoDB | Atlas | free M0 cluster | dedicated cluster |
| Redis | Upstash | free database | dedicated/paid database |
| Kafka | Redpanda Cloud Serverless | shared free cluster, `dev.`-prefixed topics | same cluster (or a dedicated one later), unprefixed topics |

Each service loads environment-specific config via
`ConfigModule.forRoot({ envFilePath: [".env.${NODE_ENV}", ".env"] })`
(NestJS services) or Next.js's built-in `.env.development`/`.env.production`
convention (frontends). See `docs/infra-setup.md` for account setup.

## Consequences
- `pnpm install` + filling in `.env.development` per service is the entire
  local setup — no `docker compose up`, no waiting for containers to become
  healthy.
- Free-tier limits apply (Neon compute hours, Atlas M0 storage cap, Upstash
  request quotas, one Redpanda Cloud cluster) — acceptable for
  development; revisit before real production load.
- Docker is **not eliminated from the project** — `apps/*/Dockerfile` is
  still how each service is built for deployment to Railway/Render (see ADR
  0005). That's a CI/build-time concern, not a local-dev one.
- Slightly less "offline-friendly" than Docker Compose — local development
  requires network access to these providers.

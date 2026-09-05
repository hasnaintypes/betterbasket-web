# BetterBasket

> A multi-tenant e-commerce marketplace built as an independently-deployable
> **Turborepo monorepo**: 3 Next.js frontends + 9 NestJS microservices,
> event-driven via Kafka, with cross-service auth via JWT/JWKS.
> Maintained by [@hasnaintypes](https://github.com/hasnaintypes).

See **[`docs/PRD.md`](docs/PRD.md)** for the phased roadmap,
**[`docs/architecture.md`](docs/architecture.md)** for how it all fits
together, and **[`docs/adr/`](docs/adr/)** for why specific choices were made.

## What this is

Independent sellers onboard their own store, list products, and get paid via
Stripe Connect. Buyers shop across every seller in one storefront and cart.
Platform admins moderate the whole marketplace. Each of the 12 apps/services
below deploys and scales independently.

## Repo structure

```
betterbasket-ecommerce/
├── apps/
│   ├── web/                     # Next.js — customer storefront
│   ├── seller-portal/           # Next.js — seller dashboard
│   ├── admin-portal/            # Next.js — platform admin
│   ├── gateway/                 # NestJS — routes /api/<service>/**, rate limits
│   ├── auth-service/            # NestJS + Better Auth (Postgres)
│   ├── product-service/         # NestJS — catalog/inventory (MongoDB)
│   ├── seller-service/          # NestJS — store onboarding, Stripe Connect (Postgres)
│   ├── order-service/           # NestJS — cart/order state machine (Postgres)
│   ├── payment-service/         # NestJS — Stripe PaymentIntents, payouts (Postgres)
│   ├── notification-service/    # NestJS — Kafka consumer, email/SMS
│   ├── media-service/           # NestJS — signed ImageKit uploads
│   ├── analytics-service/       # NestJS — Kafka -> WebSocket bridge
│   └── recommendation-service/  # FastAPI + TensorFlow (Tier 5, not built yet)
├── packages/
│   ├── ui/               # shared shadcn/ui components + Tailwind v4 theme
│   ├── config/           # shared eslint/typescript configs
│   ├── contracts/        # Zod schemas: DTOs + Kafka event payloads
│   ├── kafka-client/     # KafkaJS wrapper (Redpanda Cloud, env-aware topics)
│   ├── auth-shared/      # JWKS verification guard + Better Auth client helpers
│   ├── logger/           # Pino structured logger preset
│   └── utils/            # money/pagination/slug helpers
├── docs/                 # PRD, architecture, ADRs, API doc index
├── infra/                # deployment manifests only (no local Docker — see below)
└── .github/workflows/    # CI
```

## Tech stack

| Layer | Choice |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Frontends | Next.js 15 (App Router), Tailwind v4, shadcn/ui, TanStack Query, Zustand |
| Backend | NestJS (TypeScript) for all 9 services; FastAPI/Python planned for the deferred recommendation-service |
| Auth | [Better Auth](https://www.better-auth.com) — `organization` (sellers), `admin` (platform RBAC/ban/impersonate), `jwt`+JWKS (cross-service auth) |
| Databases | Postgres (Neon) for auth/seller/order/payment · MongoDB (Atlas) for product catalog · Redis (Upstash) for cache/sessions |
| Messaging | Kafka via Redpanda Cloud Serverless — see `packages/contracts/src/events` for the schema-validated event catalog |
| Gateway | Custom NestJS app — routes, rate-limits (`@nestjs/throttler`); auth is verified per-service, not at the gateway |
| Payments | Stripe Connect (Express accounts) |
| Media | ImageKit (signed direct browser uploads) |
| Real-time | Socket.IO (`analytics-service`) for live seller/admin dashboards |
| Validation | Zod schemas shared via `@betterbasket/contracts` (not class-validator) |
| API docs | `@nestjs/swagger` per service at `/docs` — see `docs/api/` |
| Testing | Jest + Supertest (services), Playwright (frontends), Testcontainers for real-DB integration tests |
| Deployment | Vercel (3 separate projects, one per frontend) + Railway/Render (one service per backend) — see ADR 0005 |

## Local development — no Docker required

Every datastore/broker is a real cloud service (free tiers), not a local
container — see **[`docs/infra-setup.md`](docs/infra-setup.md)** for account
setup on Neon, MongoDB Atlas, Upstash, Redpanda Cloud, Stripe, and ImageKit.

```bash
pnpm install

# Fill in each service's env — copy the example, then paste real dev credentials
cp apps/auth-service/.env.development.example apps/auth-service/.env.development
# ...repeat for every service/app you're running (see docs/infra-setup.md)

# Generate + apply the Better Auth schema (Postgres, via Neon)
pnpm --filter auth-service auth:generate-schema
pnpm --filter auth-service db:migrate

# Run everything (or use --filter to run just what you're working on)
pnpm turbo dev
```

Each service exposes `GET /health` and Swagger UI at `/docs` once running
(ports: gateway 4000, auth 4001, product 4002, seller 4003, order 4004,
payment 4005, notification 4006, media 4007, analytics 4008; frontends on
3000/3001/3002).

## Environments

Dev and prod are the *same* providers, different projects/branches — NestJS
services load `.env.${NODE_ENV}` (see `apps/*/src/app.module.ts`), Next.js
apps use its built-in `.env.development`/`.env.production` convention. No
`docker-compose` file — see [ADR 0004](docs/adr/0004-cloud-managed-infra-no-docker.md).

## Deployment

Frontends and services deploy **independently**, even though they share one
repo:

- `web`, `seller-portal`, `admin-portal` → 3 separate Vercel projects (same
  repo, different Root Directory).
- Every backend service → its own Railway/Render service, built from its
  `apps/<service>/Dockerfile`.
- CI (`.github/workflows/ci.yml`) uses Turborepo's affected-package
  filtering so a change to one service doesn't rebuild the other eleven.

See [ADR 0005](docs/adr/0005-deployment-targets.md) for the full reasoning.

## Status

Tier 0 (foundation — this scaffold) is done. See
**[`docs/PRD.md`](docs/PRD.md)** for what's implemented vs. still a
`TODO(Tier N)` in the code, and what's coming in Tiers 1–5.

## Contributing

1. Pick up a `TODO(Tier N)` from `docs/PRD.md`'s current tier.
2. `pnpm turbo lint type-check test --filter=<app-you-changed>` before opening a PR.
3. Update `docs/PRD.md`'s "Current status" section and add an ADR under
   `docs/adr/` for any decision that isn't just "implement what's already planned."

## License

MIT.

# BetterBasket

> A multi-tenant e-commerce marketplace built as an independently-deployable
> **Turborepo monorepo**: 3 Next.js frontends + 9 NestJS microservices,
> event-driven via Kafka, with cross-service auth via JWT/JWKS.
> Maintained by [@hasnaintypes](https://github.com/hasnaintypes).

Planning and design documentation is maintained privately by the maintainer.
Planned work is tracked in this repository's GitHub milestones and issues.

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
├── infra/                # deployment manifests only (no local Docker — see below)
└── .github/workflows/    # CI
```

## Tech stack

| Layer      | Choice                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monorepo   | Turborepo + pnpm workspaces                                                                                                                            |
| Frontends  | Next.js 15 (App Router), Tailwind v4, shadcn/ui, TanStack Query, Zustand                                                                               |
| Backend    | NestJS (TypeScript) for all 9 services; FastAPI/Python planned for the deferred recommendation-service                                                 |
| Auth       | [Better Auth](https://www.better-auth.com) — `organization` (sellers), `admin` (platform RBAC/ban/impersonate), `jwt`+JWKS (cross-service auth)        |
| Databases  | Postgres (Neon) for auth/seller/order/payment · MongoDB (Atlas) for product catalog · Redis (Upstash) for cache/sessions                               |
| Messaging  | Kafka via Redpanda Cloud Serverless — see `packages/contracts/src/events` for the schema-validated event catalog                                       |
| Gateway    | Custom NestJS app — routes, rate-limits (`@nestjs/throttler`); auth is verified per-service, not at the gateway                                        |
| Payments   | Stripe Connect (Express accounts)                                                                                                                      |
| Media      | ImageKit (signed direct browser uploads)                                                                                                               |
| Real-time  | Socket.IO (`analytics-service`) for live seller/admin dashboards                                                                                       |
| Validation | Zod schemas shared via `@betterbasket/contracts` (not class-validator)                                                                                 |
| API docs   | `@nestjs/swagger` per service at `/docs`                                                                                                               |
| Testing    | Jest + Supertest (services), Playwright (frontends), isolated cloud test databases for integration tests (no Testcontainers)                           |
| Deployment | Vercel (3 separate projects, one per frontend) + Render (one service per backend) _(target; no deployment configuration exists in the repository yet)_ |

## Local development — no Docker required

Every datastore/broker is a real cloud service (free tiers for development),
not a local container. You need accounts on Neon (Postgres), MongoDB Atlas,
Upstash (Redis), Redpanda Cloud (Kafka API), Stripe (test mode) and ImageKit;
each service's `.env.development.example` lists exactly which connection
strings and keys to fill in. Use separate projects/credentials per developer
and never commit real `.env.*` files (they are git-ignored).

```bash
pnpm install

# Fill in each service's env — copy the example, then paste real dev credentials
cp apps/auth-service/.env.development.example apps/auth-service/.env.development
# ...repeat for every service/app you're running (see each .env.*.example)

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

Environments use the same providers with separate projects and credentials —
NestJS services load `.env.${NODE_ENV}` (see `apps/*/src/app.module.ts`),
Next.js apps use its built-in `.env.development`/`.env.production` convention.
There is no `docker-compose` file: Docker is not required for local development.

## Deployment

Frontends and services deploy **independently**, even though they share one
repo:

- `web`, `seller-portal`, `admin-portal` → 3 separate Vercel projects (same
  repo, different Root Directory).
- Every backend service → its own Render service (deployment configuration is not yet in the repository).
- CI (`.github/workflows/ci.yml`) uses Turborepo's affected-package
  filtering so a change to one service doesn't rebuild the other eleven.

## Status

Tier 0 (the foundation scaffold) is done: the monorepo builds, services boot
with health checks, and the shared packages exist. Feature work is still to
come; see the open GitHub issues and milestones for the plan, and the
`TODO(Tier N)` markers in the code for unfinished logic.

## Contributing

1. Pick up an open GitHub issue (each issue lists its dependencies, acceptance criteria and tests).
2. `pnpm turbo lint type-check test --filter=<app-you-changed>` before opening a PR.
   CI runs the same tasks; the single required status check is **`ci-gate`** (it fails unless every CI job succeeded, and pull requests that change root or CI configuration run the full task graph instead of only the affected packages).
3. Describe in the PR which requirements and tests are covered and any architectural impact; raise a `blocked:decision` question instead of making unplanned architectural decisions.

## Security

Report suspected vulnerabilities privately through the repository's GitHub security advisory form. Do not include secrets or exploit details in public issues.

The `Security` workflow checks production dependencies, dependency changes, commit history for secrets, and JavaScript/TypeScript with CodeQL. Its aggregate `security-gate` check should be required for pull requests. A high or critical finding blocks the gate unless its identifier has an active entry in `.github/security-waivers.yml` with a reason, owner, and ISO expiry date. The file uses JSON syntax (which is also valid YAML). Expired waivers fail the gate and must be reviewed or removed. Secret findings always block the gate and require removing and rotating the affected credential.

## License

MIT.

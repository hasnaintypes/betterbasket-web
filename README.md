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

Every datastore/broker is a cloud service, not a local container. You need
development accounts on Neon (Postgres), MongoDB Atlas, Upstash (Redis),
Redpanda Cloud (Kafka API), Stripe (test mode), and ImageKit. Each service's
`.env.development.example` lists its settings. Never commit real `.env.*`
files or `.dev-projects`; both are git-ignored.

For Postgres, create a **Free** Neon development project with `dev` or
`development` in its name in the Neon Console, separate from staging and
production. Each developer gets a branch; each service gets its own database
(`bb_auth`, `bb_seller`, `bb_order`, or `bb_payment`) on that branch. Copy the
project's ID from its dashboard into
the local allow-list (one ID per line). Install the [Neon CLI](https://neon.com/docs/reference/neon-cli)
and authenticate with `neon auth`, or set `NEON_API_KEY` in your shell. The CLI
creates a developer branch with a compute and the selected service database.
The bootstrap creates a restricted runtime role with SQL on that branch; the
project's owner role is used only for migrations. Roles created through Neon's Console or CLI have elevated
`neon_superuser` membership, so do not use one as the runtime role.

```bash
pnpm install
DEV_PROJECT_ID=your-approved-free-dev-project-id
DEV_BRANCH=dev-your-name
printf '%s\n' "$DEV_PROJECT_ID" > .dev-projects

# Review the actions first; no cloud calls or files are changed.
node scripts/dev-bootstrap.mjs --project-id "$DEV_PROJECT_ID" --branch "$DEV_BRANCH" --runtime-role bb_auth_app --migrator-role neondb_owner --dry-run

# Create the branch and configure apps/auth-service/.env.development.
node scripts/dev-bootstrap.mjs --project-id "$DEV_PROJECT_ID" --branch "$DEV_BRANCH" --runtime-role bb_auth_app --migrator-role neondb_owner

# Fill in the remaining settings in the generated auth env and copy other
# service/app examples as needed (see each .env.development.example).

# Run everything (or use --filter to run just what you're working on)
pnpm turbo dev
```

Use `--service seller`, `--service order`, or `--service payment` with the same
approved project and developer branch, adding `--existing` after the first
service has created the branch. Give each service its own runtime role name.
Branch names must start with `dev-`. The bootstrap rejects IDs missing from `.dev-projects`,
checks that runtime and migration URLs belong to the same Neon endpoint, and
never prints connection strings. The pooled `-pooler` host is for application
traffic; the direct host is for Drizzle migrations, which need session features.
`DATABASE_URL` and `DIRECT_DATABASE_URL` are written to the service's
`.env.development` with private file permissions. A repeated setup can use
`--existing --manual` with its existing URLs.

If the CLI is unavailable, create a branch and the selected `bb_<service>`
database in the approved project in the Neon Console, then create a runtime
role through **SQL**, granting only the
schema usage and table/sequence DML permissions the service needs. Keep the
owner role for migrations. Place the pooled runtime URL in `NEON_RUNTIME_URL`
and the direct migrator URL in `NEON_DIRECT_URL` in your shell environment,
then run the same bootstrap command with `--manual --existing`. The script
validates the URLs before writing them. Do not paste URLs into shell commands,
issue comments, logs, or the repository.

The first auth schema and committed migrations are tracked in [issue #18](https://github.com/hasnaintypes/betterbasket-web/issues/18).
Once migrations exist, add `--migrate` to apply them through the direct URL;
`--seed` becomes available when a service adds a `db:seed` script. Grant the
runtime role DML rights after migrations and verify its DDL rights remain
absent. Until then, the new runtime role intentionally has no application
table access. As of November 2026, Neon Free allows 10 branches per project
and a six-hour instant restore window; compute suspends after five minutes of
inactivity by default, so the first connection can be slower. Check the
[current Free plan limits](https://neon.com/pricing) before creating
more branches. If a branch limit is reached, remove an unused development
branch or use an existing one; never upgrade to a paid plan as part of setup.

Each service exposes `GET /health` (liveness) and `GET /ready` (readiness). Swagger UI is available at `/docs` outside production, or in production only when `ENABLE_DOCS=true`.
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

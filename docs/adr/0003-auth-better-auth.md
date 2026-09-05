# ADR 0003: Better Auth for identity, organizations, and cross-service auth

## Status
Accepted

## Context
We need: email/password auth, multi-tenant "seller store" semantics, a
platform admin role with ban/impersonate, and a way for 8 other services to
verify a caller's identity without hammering `auth-service` on every request.

## Decision
Use [Better Auth](https://www.better-auth.com) in `auth-service`. `better-auth`
ships **pure ESM** (no CJS build), while every service in this repo compiles
to CommonJS (matches the rest of the NestJS fleet — see ADR 0001). Rather
than converting `auth-service` to full ESM (which drags in ts-node/jest ESM
loader configuration for one service), it's loaded via dynamic `import()`
from an async factory (`auth/auth.config.ts`'s `createAuth()`), which
CommonJS supports natively even for ESM-only packages. `main.ts` then mounts
Better Auth's own framework-agnostic handler directly on the underlying
Express instance (`toNodeHandler(auth)` at `/api/auth/*`) instead of going
through a Nest module wrapper — this is Better Auth's officially documented
integration path and avoids depending on a third-party Nest adapter package
(`@thallesp/nestjs-better-auth` was tried first; it turned out to also be
ESM-only and statically imports `better-auth`, so it hit the exact same
`ERR_REQUIRE_ESM` problem when required from a CJS `app.module.ts`).

Three plugins are enabled:

- **`organization`** — a seller's store *is* a Better Auth organization.
  Org roles (`owner`/`admin`/`member`) map to store staff permissions.
  Buyers never create one.
- **`admin`** — platform-wide `customer`/`admin` role, plus ban/impersonate
  for `admin-portal` moderation tools.
- **`jwt`** (+ built-in JWKS endpoint) — issues short-lived (15 min) JWTs.
  Every other service verifies these locally via `jose`'s
  `createRemoteJWKSet` against `auth-service`'s `/api/auth/jwks` (see
  `packages/auth-shared`), so **auth-service is never on the request path
  of any other service**.

"Seller" is deliberately *not* a Better Auth platform role — it's derived at
JWT-issuance time from `session.activeOrganizationId` (see
`apps/auth-service/src/auth/auth.config.ts`). A user who owns/administers an
organization is, for authorization purposes, a seller.

## Consequences
- Postgres (via Drizzle adapter) stores all identity tables; schema is
  generated with the Better Auth CLI (`auth:generate-schema` script, which
  points at `auth/auth.cli.ts` — a tiny top-level-`await` entry point the
  CLI's own loader reads directly from source, separate from our compiled
  CJS `dist/`), not hand-written, so it always matches the enabled plugin
  list.
- Downstream services depend on `@betterbasket/auth-shared`'s
  `JwtAuthGuard`/`@Auth(...)` decorator (built on `jose`, which *does* ship
  dual CJS/ESM) to verify JWTs via JWKS — not on `auth-service` directly, and
  not on any Better Auth package at all.
- `auth-service` has no global Nest auth guard — its only own route is
  `GET /health`; every actual auth endpoint is Better Auth's own handler
  mounted at `/api/auth/*`, bypassing Nest's routing/DI entirely for that
  path (by design — Better Auth owns request/response handling there).

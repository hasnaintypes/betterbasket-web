# ADR 0003: Better Auth for identity, organizations, and cross-service auth

## Status
Accepted

## Context
We need: email/password auth, multi-tenant "seller store" semantics, a
platform admin role with ban/impersonate, and a way for 8 other services to
verify a caller's identity without hammering `auth-service` on every request.

## Decision
Use [Better Auth](https://www.better-auth.com) in `auth-service`, mounted in
NestJS via the community `@thallesp/nestjs-better-auth` package, with three
plugins:

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
  generated with the Better Auth CLI (`auth:generate-schema` script), not
  hand-written, so it always matches the enabled plugin list.
- Downstream services depend on `@betterbasket/auth-shared`'s
  `JwtAuthGuard`/`@Auth(...)` decorator, not on `auth-service` directly.
- Risk: the NestJS integration is community-maintained, not official. If it
  becomes unmaintained, the fallback is mounting Better Auth's handler
  directly via a catch-all Express route (`toNodeHandler(auth)`), which is
  officially supported.

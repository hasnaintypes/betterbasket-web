# BetterBasket — Product & Engineering Requirements

Status: living document. Update this file whenever scope changes — it is
the source of truth for what "done" means at each phase, not the README.

## 1. Vision

BetterBasket is a multi-tenant e-commerce marketplace: independent sellers
run their own stores under one platform, buyers shop across all of them in
one storefront, and platform admins moderate the whole ecosystem. It is
built as a set of independently deployable services to demonstrate (and
actually use) real microservice patterns — event-driven communication,
per-service databases, a thin API gateway, JWT/JWKS-based cross-service
auth — without over-engineering into Kubernetes/service-mesh territory on
day one.

## 2. Goals

- Sellers can onboard a store, list products, and get paid (Stripe Connect)
  without platform staff involvement.
- Buyers get a fast, familiar storefront: browse, cart, checkout, track
  orders.
- Admins can see and moderate the whole platform: sellers, users, orders.
- Every write that matters to more than one service goes through Kafka, not
  a shared database.
- Each of the 12 apps/services can be deployed, scaled, and (mostly) reasoned
  about independently.

## 3. Non-goals (for now)

- Multi-currency / multi-language storefront.
- Physical logistics/shipping-carrier integration (shipping is a flat field
  on the order until there's a real need for carrier APIs).
- Mobile apps (the 3 Next.js apps are responsive web only).
- Kubernetes — see ADR 0005; we deploy to Railway/Render + Vercel first.

## 4. Personas

- **Buyer** — browses, buys, tracks orders across multiple sellers in one cart.
- **Seller** — owns a "store" (a Better Auth organization), manages products,
  fulfills orders, gets paid out via Stripe Connect.
- **Platform admin** — approves/suspends sellers, bans abusive users, watches
  platform-wide analytics.

## 5. Current status (update this as work lands)

**Tier 0 is done.** The monorepo, all 12 app/service shells, shared packages,
Better Auth wiring, and the gateway's proxy layer exist and are wired
together per `docs/architecture.md`. What's *not* done yet inside those
shells is called out explicitly per tier below (look for "Not yet built").

## 6. Tiers

Each tier is a shippable increment. Don't start tier N+1's *code* until
tier N's acceptance criteria pass — the docs/scaffolding for later tiers
already exist so the shape is clear, but the logic is intentionally
unfinished (marked with `TODO(Tier N)` in code).

### Tier 0 — Foundation ✅

**Goal:** a monorepo that installs, type-checks, and where every service
boots and responds to `/health`, with no local Docker dependency.

- Turborepo + pnpm workspaces; `packages/{contracts,ui,config,kafka-client,auth-shared,logger,utils}`.
- All 9 NestJS services + 3 Next.js apps scaffolded with health checks and Swagger.
- Better Auth wired in `auth-service` (organization + admin + jwt plugins).
- `gateway` proxies `/api/<service>/**` to each service.
- Cloud infra accounts documented (`docs/infra-setup.md`) — Neon, Atlas,
  Upstash, Redpanda Cloud, Stripe, ImageKit.

**Acceptance:** `pnpm install && pnpm turbo build` succeeds; every service's
`/health` returns `200`; `apps/web` renders its placeholder homepage.

### Tier 1 — Identity & Catalog

**Goal:** a real signed-up user can browse a real (seeded) product catalog.

- Generate + migrate the Better Auth Drizzle schema (`pnpm --filter
  auth-service auth:generate-schema && db:migrate`).
- Wire `web`'s sign-up/sign-in pages to `authClient` (Better Auth React
  client, `@betterbasket/auth-shared/client`).
- `product-service`: seed script, category taxonomy, image upload via
  `media-service` + ImageKit wired into the seller product form.
- `seller-portal`: "create store" flow (`authClient.organization.create` +
  `POST /sellers/onboard`), Stripe Connect onboarding link redirect.

**Services touched:** auth-service, product-service, media-service,
seller-service, web, seller-portal.

**Acceptance:** a new user can sign up, a seller can onboard a store and
list a product with images, and it's visible (status `active`) on `web`.

### Tier 2 — Orders

**Goal:** a buyer can complete a checkout end-to-end (test-mode Stripe).

- `order-service`: replace the `NotImplementedException` stub in
  `OrdersService.create()` with real price resolution — call
  `product-service` (HTTP) for authoritative unit prices, compute
  subtotal/total server-side, persist, split into one sub-order per seller
  for multi-vendor carts.
- `payment-service`: wire `createPaymentIntent` into the real checkout flow;
  `web` uses Stripe Elements to confirm the PaymentIntent client-side.
- Cart state: client-side (Zustand) is enough for Tier 2; a persisted
  server-side cart is a Tier 3+ nice-to-have, not required.

**Services touched:** order-service, payment-service, product-service, web.

**Acceptance:** checkout with a Stripe test card results in an order with
status `paid`, visible in both `web` (buyer) and `seller-portal` (seller).

### Tier 3 — Events & Notifications

**Goal:** the Kafka event backbone is real, not just schemas.

- Every `TODO(Tier 3): publish Topics.X` in the codebase gets implemented:
  `seller.onboarded.v1`, `order.created.v1`, `order.status-changed.v1`,
  `payment.succeeded.v1`, `payment.failed.v1`, `payment.refunded.v1`.
- `notification-service`: replace the log-only handler with real Resend
  (email) sends for order confirmation, payment receipt, seller payout.
- Idempotency: consumers dedupe on the event envelope's `id` (add a
  processed-events table or Redis set once volume justifies it).

**Services touched:** seller-service, order-service, payment-service,
notification-service.

**Acceptance:** placing an order sends a real confirmation email within a
few seconds, driven entirely by Kafka events (no direct HTTP call from
order-service to notification-service).

### Tier 4 — Real-time & Admin

**Goal:** sellers and admins see live activity, not just refreshed pages.

- `analytics-service`: add the JWT-authenticated socket handshake (join
  `org:<id>` room based on the verified token, not an unauthenticated
  namespace) — see the `NOTE (Tier 4)` in `analytics.gateway.ts`.
- `seller-portal`: live "new order" toast + sales counter via the socket.
- `admin-portal`: seller approval queue, user ban/impersonate UI wired to
  Better Auth's `admin` plugin endpoints, platform-wide live order feed.

**Services touched:** analytics-service, seller-portal, admin-portal,
auth-service (admin endpoints already exist via the plugin — just needs UI).

**Acceptance:** an admin can ban a user from `admin-portal` and see it take
effect immediately (banned user's session is revoked); a seller sees a new
order appear in their dashboard without refreshing.

### Tier 5 — Deferred (not scheduled)

Explicitly out of scope until Tiers 1–4 are solid and real usage justifies
the extra complexity:

- **`recommendation-service`** (FastAPI + TensorFlow) — personalized product
  recommendations, consuming a `user.viewed-product.v1`-style event stream.
  Lives outside Turborepo's JS task graph (see ADR 0001).
- **Real-time seller↔buyer chat** — a new `chat-service` (or a module in
  `analytics-service`'s existing Socket.IO gateway) plus UI in `web` and
  `seller-portal`.

## 7. Cross-cutting concerns (apply at every tier)

- **Testing:** unit tests (Jest) for anything with branching logic; e2e
  (Supertest) for each service's public endpoints once Tier 1+ logic lands;
  Testcontainers for any test needing a real Postgres/Mongo instance instead
  of mocking the DB layer. Playwright for `web`'s checkout flow starting
  Tier 2.
- **Security:** never trust client-supplied prices (Tier 2 price
  resolution), verify Stripe webhook signatures (already done), rate-limit
  the gateway (already done via `@nestjs/throttler`), least-privilege RBAC
  via `@Auth(...roles)` on every mutating endpoint.
- **Observability:** structured logs (`@betterbasket/logger`, Pino) exist
  from Tier 0; shipping them to Axiom/Better Stack + OpenTelemetry tracing
  is a Tier 3+ addition once there's real traffic to observe.

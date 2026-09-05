# Architecture

See `docs/PRD.md` for the phased roadmap and `docs/adr/` for individual
decisions. This doc is the "how it all fits together" reference.

## System context

```mermaid
flowchart TB
    subgraph Frontends
        web[web<br/>customer storefront]
        seller[seller-portal]
        admin[admin-portal]
    end

    gw[gateway]

    subgraph Services
        auth[auth-service]
        product[product-service]
        seller_svc[seller-service]
        order[order-service]
        payment[payment-service]
        notif[notification-service]
        media[media-service]
        analytics[analytics-service]
    end

    subgraph Infra
        pg[(Postgres / Neon)]
        mongo[(MongoDB / Atlas)]
        redis[(Redis / Upstash)]
        kafka[[Redpanda Cloud]]
    end

    web --> gw
    seller --> gw
    admin --> gw
    web -.WebSocket.-> analytics
    seller -.WebSocket.-> analytics

    gw --> auth
    gw --> product
    gw --> seller_svc
    gw --> order
    gw --> payment
    gw --> notif
    gw --> media
    gw --> analytics

    auth --> pg
    seller_svc --> pg
    order --> pg
    payment --> pg
    product --> mongo

    seller_svc --> kafka
    order --> kafka
    payment --> kafka
    notif --> kafka
    analytics --> kafka
    product --> kafka
```

## Services

| Service | Responsibility | Datastore | Talks to Kafka? |
|---|---|---|---|
| `gateway` | Routes `/api/<x>/**` to the right service, rate limits, CORS | — | no |
| `auth-service` | Identity, RBAC, organizations (Better Auth) | Postgres | no (yet) |
| `product-service` | Catalog, inventory | MongoDB | producer |
| `seller-service` | Store onboarding, Stripe Connect account linkage | Postgres | producer |
| `order-service` | Cart → order state machine, multi-vendor splitting | Postgres | producer |
| `payment-service` | Stripe PaymentIntents, webhooks, payout ledger | Postgres | producer |
| `notification-service` | Fans out to email/SMS/push | — | consumer |
| `media-service` | Signed direct-upload params for ImageKit | — | no |
| `analytics-service` | Kafka → WebSocket bridge for live dashboards | — | consumer |
| `recommendation-service` *(Tier 5, not built)* | ML-based product recommendations | — | consumer |

## Auth flow (cross-service)

```mermaid
sequenceDiagram
    participant FE as Frontend (Next.js)
    participant Auth as auth-service (Better Auth)
    participant GW as gateway
    participant Svc as product-service (example)

    FE->>Auth: sign-in (email/password)
    Auth-->>FE: session cookie + JWT (via jwt plugin)
    FE->>GW: POST /api/products (Authorization: Bearer <jwt>)
    GW->>Svc: proxy request (unchanged)
    Svc->>Auth: GET /api/auth/jwks (cached indefinitely, keyed by kid)
    Svc->>Svc: verify JWT locally (jose + JWKS), read role/org claims
    Svc-->>GW: 201 Created
    GW-->>FE: 201 Created
```

The gateway never decodes the JWT — it only routes + rate-limits. Every
service is independently responsible for authz, using
`@betterbasket/auth-shared`'s `JwtAuthGuard` / `@Auth(...roles)`.

## Order → payment event flow (Tier 2/3)

```mermaid
sequenceDiagram
    participant Buyer
    participant Order as order-service
    participant Product as product-service
    participant Payment as payment-service
    participant Notif as notification-service
    participant Analytics as analytics-service

    Buyer->>Order: POST /orders {items}
    Order->>Product: resolve authoritative prices (HTTP)
    Order->>Order: persist order (status=pending)
    Order-->>Buyer: 201 {orderId}
    Order->>Payment: POST /payments/intents
    Payment-->>Buyer: clientSecret (Stripe Elements confirms on client)
    Payment->>Payment: Stripe webhook: payment_intent.succeeded
    Payment-->>Order: publish Topics.PaymentSucceeded
    Order->>Order: status -> paid, publish Topics.OrderStatusChanged
    Order-->>Notif: (via Kafka) Topics.OrderStatusChanged
    Order-->>Analytics: (via Kafka) Topics.OrderStatusChanged
    Notif->>Buyer: order confirmation email
    Analytics->>Analytics: emit WebSocket event to seller-portal
```

## Event catalog

Defined in `packages/contracts/src/events/`. Every event is versioned in its
topic name (`.v1`) and validated with Zod at publish *and* consume time
(`packages/kafka-client`).

| Topic | Producer | Consumers | Payload |
|---|---|---|---|
| `user.registered.v1` | auth-service *(Tier 3)* | notification-service | `{ userId, email, role }` |
| `seller.onboarded.v1` | seller-service | notification-service, analytics-service | `{ sellerId, organizationId, stripeAccountId }` |
| `product.created.v1` | product-service | analytics-service | `{ productId, sellerId, title }` |
| `product.stock-changed.v1` | product-service | order-service *(future)*, analytics-service | `{ productId, variantId, newStock }` |
| `order.created.v1` | order-service | analytics-service, notification-service | `{ orderId, buyerId, total, sellerIds }` |
| `order.status-changed.v1` | order-service | notification-service, analytics-service | `{ orderId, previousStatus, newStatus }` |
| `payment.succeeded.v1` | payment-service | order-service, analytics-service | `{ orderId, paymentId, amount }` |
| `payment.failed.v1` | payment-service | order-service, notification-service | `{ orderId, reason }` |
| `payment.refunded.v1` | payment-service | order-service, notification-service | `{ orderId, paymentId, amount }` |
| `notification.requested.v1` | any service | notification-service | `{ userId, channel, template, data }` |

Dev/prod share one Redpanda Cloud cluster via `KAFKA_TOPIC_PREFIX`
(`dev.order.created.v1` vs `order.created.v1`) — see ADR 0004.

## API documentation

Every service exposes its own OpenAPI spec via `@nestjs/swagger` at
`/docs` (e.g. `http://localhost:4002/docs` for product-service). The gateway
also serves its own routing-level spec at `/docs`. `docs/api/` aggregates
links to all of them (see `docs/api/README.md`) — a Scalar/Redocly portal
gets wired up once there are enough real endpoints to be worth aggregating
(Tier 2+).

## Validation strategy

DTOs are Zod schemas in `packages/contracts`, not class-validator classes —
one source of truth shared between REST bodies, Kafka event payloads, and
(via `@betterbasket/contracts` imported in frontends) form validation. Each
service has a small local `ZodValidationPipe` (see
`apps/product-service/src/common/zod-validation.pipe.ts`) until it's worth
promoting to a shared package.

## What's intentionally not built yet

See `docs/PRD.md` for the full phased breakdown. In short: authoritative
price resolution in `order-service`, most Kafka event publishing (schemas
exist, most producers have `TODO(Tier N)` markers), the aggregated API docs
portal, and everything in Tier 5 (recommendations, real-time chat).

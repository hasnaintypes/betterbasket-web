# ADR 0002: Polyglot persistence, database-per-service

## Status
Accepted

## Context
A microservices architecture loses most of its value if every service reads
and writes the same shared database — that's a distributed monolith.

## Decision
- **Postgres** (Neon, one branch per environment) for anything transactional
  or relational: `auth-service`, `seller-service`, `order-service`,
  `payment-service`. Each service owns its own database — no cross-service
  foreign keys, no shared connection pool.
- **MongoDB** (Atlas) for `product-service` — product catalogs have a
  flexible, evolving shape (variants, per-category attributes) that fits
  a document model better than a fixed relational schema.
- **Redis** (Upstash) for cache/session/rate-limit state, introduced from
  Tier 3 onward.
- ORM: **Drizzle** for all Postgres services (lightweight, SQL-first,
  first-class Better Auth adapter). **Mongoose** for the Mongo-based
  product-service.

## Consequences
- Cross-service reads happen over HTTP (via the gateway or direct
  service-to-service calls) or via Kafka events — never via a shared DB
  connection. `order-service`, for example, resolves prices from
  `product-service` at order-creation time (see PRD Tier 2) rather than
  joining tables.
- More operational surface (4 Postgres databases + 1 Mongo cluster instead
  of one shared DB), offset by using managed/serverless providers for all
  of them (see ADR 0004).

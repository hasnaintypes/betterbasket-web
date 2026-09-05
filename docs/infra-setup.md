# Infra Setup (no Docker required)

Every datastore/broker is a real cloud service — there is no local
Postgres/Mongo/Redis/Kafka to install or run. "Dev" and "prod" are just
different projects/branches/clusters on the same providers. This keeps local
setup to "copy connection strings into `.env.development`" and removes an
entire class of "works on my machine" Docker problems on Windows.

## 1. Postgres — Neon

Used by: `auth-service`, `seller-service`, `order-service`, `payment-service`.

1. Create a free project at [neon.tech](https://neon.tech).
2. Create two branches: `dev` and `prod` (Neon branching = instant, cheap —
   `prod` branch only gets real traffic once you actually deploy).
3. In each branch, create one database per service that needs one:
   `betterbasket_auth`, `betterbasket_seller`, `betterbasket_order`,
   `betterbasket_payment`.
4. Copy each database's connection string (Neon dashboard → Connect) into
   the matching service's `DATABASE_URL` in `.env.development` (from the
   `dev` branch) — and later `.env.production` (from the `prod` branch).
5. Run migrations per service:
   ```bash
   pnpm --filter auth-service db:generate
   pnpm --filter auth-service db:migrate
   # repeat for seller-service, order-service, payment-service
   ```

## 2. MongoDB — Atlas

Used by: `product-service`.

1. Create a free M0 cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Create a database user + allow your IP (or `0.0.0.0/0` for dev-only convenience).
3. Copy the SRV connection string into `product-service/.env.development`'s
   `MONGODB_URI`, pointed at a `betterbasket_products_dev` database.
4. For prod, create a dedicated (paid, dedicated-tier) cluster later — never
   share the free dev cluster with production traffic.

## 3. Redis — Upstash

Used by: rate-limiting/caching (introduced from Tier 3 onward — see `docs/PRD.md`).

1. Create a free database at [upstash.com](https://upstash.com).
2. Copy the `REDIS_URL` (or REST URL + token, if a service uses
   `@upstash/redis` instead of a TCP client) into the relevant service's env.

## 4. Kafka — Redpanda Cloud Serverless

Used by: `product-service`, `seller-service`, `order-service`,
`payment-service`, `notification-service`, `analytics-service`.

1. Create a free Serverless cluster at
   [redpanda.com/redpanda-cloud](https://redpanda.com/redpanda-cloud).
2. Create a SASL user (username/password) scoped to that cluster.
3. Copy the bootstrap server URL into `KAFKA_BROKERS`, and the SASL
   credentials into `KAFKA_USERNAME`/`KAFKA_PASSWORD` in every consuming
   service's `.env.development`.
4. **One cluster, two environments:** the free tier gives you one cluster.
   Dev and prod share it safely via topic prefixing —
   `KAFKA_TOPIC_PREFIX=dev.` in `.env.development`,
   `KAFKA_TOPIC_PREFIX=` (empty) in `.env.production`. See
   `packages/kafka-client/src/env.ts`. Once you outgrow the free tier,
   create a second cluster for prod and drop the prefix trick.

## 5. Stripe Connect

Used by: `seller-service`, `payment-service`.

1. Create a Stripe account, enable **Connect** (Express accounts).
2. Use test-mode keys (`sk_test_...`) in `.env.development`.
3. For webhooks locally, use the Stripe CLI: `stripe listen --forward-to
   localhost:4005/payments/webhook` and paste the printed `whsec_...` into
   `payment-service/.env.development`.

## 6. ImageKit

Used by: `media-service`.

1. Create a free account at [imagekit.io](https://imagekit.io).
2. Create a "dev" and a "prod" media library (or just prefix folders) and
   copy the public/private keys + URL endpoint into `media-service`'s env
   files.

## Summary: what goes where

| Service | Needs |
|---|---|
| gateway | nothing but the other services' URLs |
| auth-service | Neon (`betterbasket_auth`) |
| product-service | Atlas, Redpanda Cloud |
| seller-service | Neon (`betterbasket_seller`), Redpanda Cloud, Stripe |
| order-service | Neon (`betterbasket_order`), Redpanda Cloud |
| payment-service | Neon (`betterbasket_payment`), Redpanda Cloud, Stripe |
| notification-service | Redpanda Cloud, Resend |
| media-service | ImageKit |
| analytics-service | Redpanda Cloud |

Copy `.env.development.example` → `.env.development` in each
`apps/<name>/` you're running locally and fill in the values above. Never
commit the real `.env.development`/`.env.production` files (already covered
by `.gitignore`).

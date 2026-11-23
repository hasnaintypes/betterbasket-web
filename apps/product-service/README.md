# Product service data model

Products belong to a seller record (`sellerId` UUID), not an auth-service
organization or user. The Mongoose schema stores stable UUID `variantId` values,
integer USD prices, nonnegative stock, `draft|active|unpublished|archived`
product status, denormalized `active|suspended|other` seller status, and a
nonnegative optimistic-locking `version`. New products start as `draft` with
`sellerStatus=other`, so public catalog reads exclude them until seller state is
confirmed. Descriptions are plain text. The API derives `sellerId` from the
capability decision; clients cannot supply it.

Indexes cover unique product slugs, unique `(sellerId, variants.sku)` for
nonempty variant SKUs, storefront filtering by status, seller status, category
and creation date, title and description text search, and seller status lists.
The Mongo multikey unique index enforces SKU uniqueness across product
documents for a seller. Schema validation also rejects duplicate SKUs within
one product. A SKU may be used by another seller. New slugs use the normalized
title and a random six-character suffix; only a slug collision is retried.

## Development-data migration

Run `pnpm --filter product-service db:migrate:v2` against a development Mongo
database after backing it up. Supply `PRODUCT_LEGACY_SELLER_MAP` as a JSON object
mapping each legacy `organizationId` to its seller record UUID. The migration
fails closed if a legacy tenant cannot be mapped. It retains valid existing
slugs, transforms each document atomically, removes `organizationId`, and sets
`schemaVersion=2`. Re-running it skips completed documents and checks the
indexes again. `sellerStatus` becomes `other` for migrated documents until a
trusted seller status update has been applied; this keeps them out of public
results. Duplicate seller SKUs or slugs must be resolved before index creation.
Keep the mapping out of the repository and command logs.

## Verification

`pnpm --filter product-service test` runs unit tests without MongoDB. Set
`PRODUCT_TEST_MONGODB_URI` to a dedicated cloud test project's URI, build the
package, then run `pnpm --filter product-service test:integration`. Each run
uses a unique `ci_` database and drops it afterward. Never use a production
connection for integration tests. No local Docker service is required.

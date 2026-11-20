# Seller-service schema and migrations

`src/db/schema.ts` defines `sellers`, `seller_members`,
`seller_status_history`, and the shared Postgres `outbox` and
`processed_events` tables. The seller row ID is the tenant key. The
organization ID only links the seller to the auth-service organization;
there is no cross-database foreign key.

The first migration in `drizzle/` applies to an empty schema or upgrades the
previous `sellers` table. It adds `under_review` and `closed` states, country,
support email, approval and suspension fields, and an optimistic-locking
`version`. Existing seller rows are retained. The new outbox table includes
`next_attempt_at` and `quarantined_at` for the shared relay. The inbox table
supports the shared transactional consumer wrapper. No relay or consumer is
registered by this migration.

Run migrations with the separate migrator role and the direct Postgres URL:

```sh
pnpm --filter seller-service db:check
pnpm --filter seller-service db:migrate
```

The runtime service uses the pooled `DATABASE_URL` role without DDL rights.
Use a disposable development branch or schema for migration tests; set
`SELLER_TEST_DATABASE_URL` securely and run
`pnpm --filter seller-service test:integration`. The test creates and drops
isolated schemas and never prints the URL. Do not run the test against a
production database.

Store slugs are normalized, checked against reserved words, and given a random
suffix. Only slug unique-index collisions are retried. The migration installs
a trigger that rejects slug changes after approval, including legacy rows
already in an active or suspended state. Later lifecycle work must populate
`approved_at`, write status history and outbox rows in the same transaction,
and increment `version` with an optimistic-locking update.

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

## Seller registration

`POST /sellers/onboard` accepts a verified owner's bearer token with an active
organization and a JSON body containing `storeName`, `slug`, `country` (uppercase
ISO 3166-1 alpha-2), `supportEmail`, and optional `description`. The organization
ID comes only from the verified token. The route returns HTTP 200 with
`{ id, status, slug }`; a repeat request for the same organization returns the
existing seller, including after simultaneous submits. A new seller starts in
`pending`. This route does not create a Stripe account.

Set `SUPPORTED_SELLER_COUNTRIES` to a comma-separated list of allowed country
codes. An empty value disables new registrations outside `NODE_ENV=test`.
Email must be verified; a non-owner gets 403, and a verified user without an
active organization gets 400. Existing seller operations remain behind the
seller access provider and are denied until it is implemented.

Store slugs are normalized, checked against reserved words, and given a random
suffix. Only slug unique-index collisions are retried. The migration installs
a trigger that rejects slug changes after approval, including legacy rows
already in an active or suspended state. Later lifecycle work must populate
`approved_at`, write status history and outbox rows in the same transaction,
and increment `version` with an optimistic-locking update.

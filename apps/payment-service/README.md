# Payment-service data and webhook foundation

The gateway forwards only `POST /webhooks/stripe/account` and
`POST /webhooks/stripe/connect` to this service's
`/payments/webhook/account` and `/payments/webhook/connect` routes. Each route
requires the exact raw request body and its own webhook signing secret.
Payment-service verifies the signature with the Stripe SDK before writing a
row. A missing or invalid signature returns 400; a body above 1 MB returns 413. The old `/payments/webhook` route is removed.

Configure `STRIPE_ACCOUNT_WEBHOOK_SECRET` and
`STRIPE_CONNECT_WEBHOOK_SECRET` separately. Both are required at boot.
`PAYMENTS_LIVE_MODE_ENABLED` defaults to `false` and rejects a `sk_live_` key
while false. Keep all testing and development on Stripe test keys. No Stripe
network calls are needed for the signed-fixture tests.

The first service-owned migration creates `stripe_events`, `outbox`, and
`processed_events`. The next migration replaces any prototype `payments` and
`payout_ledger` tables with one platform payment per order, immutable
`ledger_entries`, one transfer per seller sub-order, refunds, disputes,
reconciliation exceptions, and the shared `idempotency_keys` table. No payment
data exists in the prototype tables to preserve. The new migration is additive
to the webhook tables. It must be applied before code that uses the new model.

Amounts are integer minor units. Payment, ledger, transfer, refund, and dispute
amounts must be positive; currency is an uppercase three-letter code (the
current product uses USD). PaymentIntent and order IDs are unique per payment;
sub-order IDs are unique per transfer. Ledger rows move an amount between
distinct debit and credit accounts, carry a provider object reference and a
unique deterministic idempotency key, and are never edited. Corrections use
new compensating entries. Balances are derived from ledger entries. Posting,
allocation, and refund-limit rules are implemented in later issues.

Apply `sql/bootstrap_roles.sql` as the database owner before migrations,
provision login credentials through the secret manager, then run migrations
as `payment_migrator` over the direct Postgres URL. Run
`sql/grant_runtime.sql` as the database owner after each migration. The pooled
runtime `DATABASE_URL` must use `payment_app`; it has DML rights on service
tables but only `SELECT` and `INSERT` on `ledger_entries` and no schema DDL.
Do not use the owner or migrator role for the application connection. The
bootstrap script creates roles without passwords or login rights, so the
database administrator must enable their login when provisioning credentials.

The old client-priced destination-charge `POST /payments/intents` prototype
returns 501. Issue #98 will implement the order-derived platform PaymentIntent
flow; this schema change does not create Stripe objects or post ledger entries.

`stripe_events` deduplicates by Stripe event ID. Unknown event types are stored
and marked processed. Processors register by scope and type and must write
all business effects and outbox rows through the supplied Postgres client so
they commit with the processed marker. No payment-intent or `account.updated`
processor is registered yet. A failed processor leaves a `failed` row and
returns 500. A 30-second sweeper retries failed rows and `received` rows left
by a crash; it serializes processing with `FOR UPDATE`. Processed rows are
purged after 90 days by a daily retention job. Failed rows remain for recovery.

Run `pnpm --filter payment-service db:check` to validate migration metadata.
The integration suite uses `PAYMENT_TEST_DATABASE_URL` and creates disposable
schemas and roles; the development test role needs `CREATEROLE`. Keep the URL
in a secure ignored setting and use a development test database. Run it with
`pnpm --filter payment-service test:integration`.

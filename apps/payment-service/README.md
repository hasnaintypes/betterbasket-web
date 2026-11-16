# Payment-service webhook foundation

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

The service-owned `drizzle/` migration creates only `stripe_events`, `outbox`,
and `processed_events`. Apply it with a separate migrator role and the direct
Postgres URL before routing webhooks to the service. The runtime uses the
pooled `DATABASE_URL` role without DDL rights. This migration does not add the
existing prototype `payments` or `payout_ledger` tables; the full payment
schema belongs to issue #95.

`stripe_events` deduplicates by Stripe event ID. Unknown event types are stored
and marked processed. Processors register by scope and type and must write
all business effects and outbox rows through the supplied Postgres client so
they commit with the processed marker. No payment-intent or `account.updated`
processor is registered yet. A failed processor leaves a `failed` row and
returns 500. A 30-second sweeper retries failed rows and `received` rows left
by a crash; it serializes processing with `FOR UPDATE`. Processed rows are
purged after 90 days by a daily retention job. Failed rows remain for recovery.

Run `pnpm --filter payment-service db:check` to validate migration metadata.
The integration suite uses `PAYMENT_TEST_DATABASE_URL` and creates a disposable
schema; keep the URL in a secure ignored setting and use a development test
database. Run it with `pnpm --filter payment-service test:integration`.

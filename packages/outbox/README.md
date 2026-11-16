# Postgres outbox

Use `outboxTable` in an adopting service's Drizzle schema and add a service-owned
migration before calling `OutboxWriter.add(tx, event)`. The writer validates the
complete v2 envelope against `EventSchemaByTopic`, caps the serialized event at
256 KB, and inserts through the caller's transaction. A rollback therefore
rolls back the event row too. Keep credentials and sensitive fields out of event
payloads.

The table needs `id`, `aggregate_type`, `aggregate_id`, `type`, `version`,
`payload`, `headers`, `created_at`, `published_at`, `attempts`,
`next_attempt_at`, and `quarantined_at`. Existing auth-service deployments
already have the original outbox columns; add the last two columns in a
service migration before adopting this relay. The shared package does not run
migrations or change auth-service startup.

Register `OutboxRelay` with a Postgres pool and a `publish(message)` function.
The function must resolve only after an idempotent producer receives `acks=all`.
The relay publishes with `aggregateId` as the broker key, locks one due row per
aggregate with `FOR UPDATE SKIP LOCKED`, and marks it published after the ack.
A crash between ack and mark republishes the same event id; consumers must
deduplicate it. Failures back off exponentially and quarantine after 20
attempts. Use `onQuarantine` for an alert. Call
`oldestUnpublishedAgeSeconds()` from readiness/metrics and alert above 60
seconds. Published rows older than seven days are purged hourly. Nest starts
and stops the loop through module lifecycle hooks.

The integration test uses a dedicated, disposable Postgres database from
`OUTBOX_TEST_DATABASE_URL` and never logs the connection string. It creates
and drops its own table. Point it at a Neon test project; do not use a runtime
application role that lacks schema privileges.

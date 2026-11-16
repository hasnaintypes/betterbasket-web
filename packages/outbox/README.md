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

## Consumer inbox

Add `processedEventsTable` through each consuming service's own migration before
using `new Inbox(db)`. The auth-service already has a compatible table. Use a
consumer name in `<env>.<service>.<purpose>` form and the event envelope's UUID
as `eventId`. `Inbox.run({ consumer, eventId }, async (tx) => { ... })` opens a
transaction, claims the event, and passes that same transaction to the handler.
Write every business effect through `tx`. A duplicate returns
`{ processed: false }` without calling the handler; a successful first delivery
returns `{ processed: true, value }`. If the handler throws, the claim and its
effects roll back so the event can be retried. Do not acknowledge a message
until `run` resolves.

Register `InboxRetention` in a Nest module to delete processed rows at startup
and hourly, or call `purgeProcessedEvents(db)` from a service-owned scheduler.
Retention is 14 days. Keep the broker replay window at or below 14 days, or a
replayed event can be processed again after its inbox row is removed. The shared
package does not run migrations or register jobs in consuming services.

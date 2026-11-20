import { outboxTable, processedEventsTable } from "@betterbasket/outbox";
import { index, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const stripeEventScopeEnum = pgEnum("stripe_event_scope", ["account", "connect"]);
export const stripeEventStatusEnum = pgEnum("stripe_event_status", [
  "received",
  "processed",
  "failed",
]);

export const stripeEvents = pgTable(
  "stripe_events",
  {
    eventId: text("event_id").primaryKey(),
    scope: stripeEventScopeEnum("scope").notNull(),
    type: text("type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: stripeEventStatusEnum("status").notNull().default("received"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index("stripe_events_retry_idx").on(table.status, table.receivedAt),
    index("stripe_events_retention_idx").on(table.processedAt),
  ],
);

export const outbox = outboxTable;
export const processedEvents = processedEventsTable;

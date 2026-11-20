import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Add through each consuming service's own migration before using Inbox. */
export const processedEventsTable = pgTable(
  "processed_events",
  {
    consumer: text("consumer").notNull(),
    eventId: uuid("event_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.consumer, table.eventId] }),
    index("processed_events_processed_at_idx").on(table.processedAt),
  ],
);

/** Each adopting service adds this table with its own migration. */
export const outboxTable = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    type: text("type").notNull(),
    version: integer("version").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    headers: jsonb("headers").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
  },
  (table) => [
    index("outbox_due_idx").on(table.publishedAt, table.quarantinedAt, table.nextAttemptAt),
    index("outbox_aggregate_order_idx").on(
      table.aggregateType,
      table.aggregateId,
      table.createdAt,
      table.id,
    ),
  ],
);

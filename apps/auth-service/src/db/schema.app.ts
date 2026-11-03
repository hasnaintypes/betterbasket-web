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

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: text("actor_id"),
    actorType: text("actor_type").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    requestId: uuid("request_id"),
    ipHash: text("ip_hash"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("audit_log_at_idx").on(table.at),
    index("audit_log_actor_at_idx").on(table.actorId, table.at),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    type: text("type").notNull(),
    version: integer("version").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    headers: jsonb("headers").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [
    index("outbox_unpublished_idx").on(table.publishedAt, table.createdAt),
    index("outbox_aggregate_order_idx").on(table.aggregateType, table.aggregateId, table.createdAt),
  ],
);

export const processedEvents = pgTable(
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

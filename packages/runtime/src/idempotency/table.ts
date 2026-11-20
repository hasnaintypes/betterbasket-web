import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** Adopt in each Postgres service's schema and migration. */
export const idempotencyKeysTable = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: varchar("key", { length: 255 }).notNull(),
    requestHash: text("request_hash").notNull(),
    status: integer("status"),
    response: jsonb("response").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inProgressUntil: timestamp("in_progress_until", { withTimezone: true }),
    ownerId: uuid("owner_id"),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.key] }),
    index("idempotency_keys_expires_at_idx").on(table.expiresAt),
    check("idempotency_keys_hash_sha256", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "idempotency_keys_status_range",
      sql`${table.status} IS NULL OR ${table.status} BETWEEN 100 AND 599`,
    ),
    check(
      "idempotency_keys_response_pair",
      sql`(${table.status} IS NULL AND ${table.response} IS NULL) OR (${table.status} IS NOT NULL AND ${table.response} IS NOT NULL)`,
    ),
  ],
);

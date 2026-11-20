import { outboxTable, processedEventsTable } from "@betterbasket/outbox";
import { integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const sellerStatusEnum = pgEnum("seller_status", [
  "pending",
  "stripe_pending",
  "under_review",
  "active",
  "suspended",
  "closed",
]);

export const sellerMemberRoleEnum = pgEnum("seller_member_role", ["owner", "admin", "member"]);

/**
 * Commerce metadata for a seller store. `organizationId` is a foreign key
 * (by value, not DB constraint — different service/database) into Better
 * Auth's `organization` table over in auth-service.
 */
export const sellers = pgTable("sellers", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().unique(),
  storeName: text("store_name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  logoUrl: text("logo_url"),
  stripeAccountId: text("stripe_account_id"),
  country: text("country"),
  supportEmail: text("support_email"),
  status: sellerStatusEnum("status").notNull().default("pending"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sellerMembers = pgTable(
  "seller_members",
  {
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: sellerMemberRoleEnum("role").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sellerId, table.userId] })],
);

export const sellerStatusHistory = pgTable("seller_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerId: uuid("seller_id")
    .notNull()
    .references(() => sellers.id, { onDelete: "cascade" }),
  fromStatus: sellerStatusEnum("from_status").notNull(),
  toStatus: sellerStatusEnum("to_status").notNull(),
  actorId: text("actor_id"),
  reason: text("reason"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const outbox = outboxTable;
export const processedEvents = processedEventsTable;

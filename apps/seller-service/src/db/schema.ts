import { pgTable, text, timestamp, uuid, pgEnum } from "drizzle-orm/pg-core";

export const sellerStatusEnum = pgEnum("seller_status", [
  "pending",
  "stripe_pending",
  "active",
  "suspended",
]);

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
  status: sellerStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

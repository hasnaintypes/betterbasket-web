import { pgTable, text, timestamp, uuid, pgEnum, integer, jsonb } from "drizzle-orm/pg-core";
import type { OrderItem } from "@betterbasket/contracts";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "awaiting_payment",
  "paid",
  "fulfilling",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerId: text("buyer_id").notNull(),
  items: jsonb("items").$type<OrderItem[]>().notNull(),
  subtotalAmount: integer("subtotal_amount").notNull(),
  shippingAmount: integer("shipping_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: orderStatusEnum("status").notNull().default("pending"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

import { pgTable, text, timestamp, uuid, pgEnum, integer } from "drizzle-orm/pg-core";

export const paymentStatusEnum = pgEnum("payment_status", [
  "requires_payment",
  "processing",
  "succeeded",
  "failed",
  "refunded",
]);

/**
 * One row per Stripe PaymentIntent. For multi-vendor carts, order-service
 * splits a cart into one sub-order per seller (Tier 2) and payment-service
 * creates one PaymentIntent per sub-order with `transfer_data.destination`
 * set to that seller's connected account — simpler than one PaymentIntent
 * split N ways, at the cost of the buyer seeing N charges for a mixed cart.
 */
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: text("order_id").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
  connectedAccountId: text("connected_account_id").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: paymentStatusEnum("status").notNull().default("requires_payment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payoutLedger = pgTable("payout_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull(),
  sellerId: text("seller_id").notNull(),
  stripeAccountId: text("stripe_account_id").notNull(),
  grossAmount: integer("gross_amount").notNull(),
  platformFee: integer("platform_fee").notNull(),
  netAmount: integer("net_amount").notNull(),
  stripeTransferId: text("stripe_transfer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

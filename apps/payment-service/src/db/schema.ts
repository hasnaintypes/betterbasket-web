import { idempotencyKeysTable } from "@betterbasket/runtime";
import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export {
  stripeEvents,
  outbox,
  processedEvents,
  stripeEventScopeEnum,
  stripeEventStatusEnum,
} from "./webhook.schema";

export const paymentStatusEnum = pgEnum("payment_status", [
  "requires_payment",
  "processing",
  "succeeded",
  "failed",
  "refunded",
]);
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "charge",
  "seller_allocation",
  "commission",
  "processing_fee",
  "transfer",
  "refund",
  "transfer_reversal",
  "refund_clearing",
  "dispute_debit",
  "dispute_fee",
  "dispute_credit",
  "adjustment",
  "platform_receivable",
]);
export const transferStatusEnum = pgEnum("transfer_status", [
  "pending",
  "held",
  "processing",
  "succeeded",
  "failed",
  "reversed",
]);
export const refundStatusEnum = pgEnum("payment_refund_status", ["pending", "succeeded", "failed"]);
export const disputeStatusEnum = pgEnum("dispute_status", [
  "needs_response",
  "under_review",
  "won",
  "lost",
  "closed",
]);
export const reconciliationExceptionStatusEnum = pgEnum("reconciliation_exception_status", [
  "open",
  "resolved",
]);

/** One platform PaymentIntent per order; seller payouts use separate Transfers. */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
    amount: integer("amount").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: paymentStatusEnum("status").notNull().default("requires_payment"),
    chargeId: text("charge_id").unique(),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payments_status_created_idx").on(table.status, table.createdAt),
    check("payments_amount_positive", sql`${table.amount} > 0`),
    check("payments_currency_uppercase", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("payments_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

/** Each immutable row moves value between two accounts; corrections are new rows. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id").references(() => payments.id),
    orderId: uuid("order_id"),
    subOrderId: uuid("sub_order_id"),
    sellerId: uuid("seller_id"),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    debitAccount: text("debit_account").notNull(),
    creditAccount: text("credit_account").notNull(),
    amount: integer("amount").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    providerObjectType: text("provider_object_type").notNull(),
    providerObjectId: text("provider_object_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ledger_entries_payment_created_idx").on(table.paymentId, table.createdAt),
    index("ledger_entries_sub_order_created_idx").on(table.subOrderId, table.createdAt),
    index("ledger_entries_provider_idx").on(table.providerObjectType, table.providerObjectId),
    check("ledger_entries_amount_positive", sql`${table.amount} > 0`),
    check("ledger_entries_currency_uppercase", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("ledger_entries_distinct_accounts", sql`${table.debitAccount} <> ${table.creditAccount}`),
    check(
      "ledger_entries_accounts_nonempty",
      sql`length(trim(${table.debitAccount})) > 0 AND length(trim(${table.creditAccount})) > 0`,
    ),
    check(
      "ledger_entries_provider_nonempty",
      sql`length(trim(${table.providerObjectType})) > 0 AND length(trim(${table.providerObjectId})) > 0`,
    ),
  ],
);

export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subOrderId: uuid("sub_order_id").notNull().unique(),
    sellerId: uuid("seller_id").notNull(),
    stripeAccountId: text("stripe_account_id").notNull(),
    amount: integer("amount").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: transferStatusEnum("status").notNull().default("pending"),
    releaseAt: timestamp("release_at", { withTimezone: true }),
    stripeTransferId: text("stripe_transfer_id").unique(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("transfers_seller_status_idx").on(table.sellerId, table.status),
    index("transfers_release_idx").on(table.status, table.releaseAt),
    check("transfers_amount_positive", sql`${table.amount} > 0`),
    check("transfers_currency_uppercase", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("transfers_attempts_nonnegative", sql`${table.attempts} >= 0`),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    orderId: uuid("order_id").notNull(),
    subOrderId: uuid("sub_order_id"),
    amount: integer("amount").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: refundStatusEnum("status").notNull().default("pending"),
    reasonCode: text("reason_code").notNull(),
    requestedBy: text("requested_by").notNull(),
    stripeRefundId: text("stripe_refund_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("refunds_order_created_idx").on(table.orderId, table.createdAt),
    check("refunds_amount_positive", sql`${table.amount} > 0`),
    check("refunds_currency_uppercase", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    stripeDisputeId: text("stripe_dispute_id").notNull().unique(),
    amount: integer("amount").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: disputeStatusEnum("status").notNull(),
    reason: text("reason"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("disputes_payment_status_idx").on(table.paymentId, table.status),
    check("disputes_amount_positive", sql`${table.amount} > 0`),
    check("disputes_currency_uppercase", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const reconciliationExceptions = pgTable(
  "reconciliation_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id").references(() => payments.id),
    kind: text("kind").notNull(),
    providerObjectType: text("provider_object_type").notNull(),
    providerObjectId: text("provider_object_id").notNull(),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: reconciliationExceptionStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    unique("reconciliation_exceptions_provider_kind_unique").on(
      table.providerObjectType,
      table.providerObjectId,
      table.kind,
    ),
    index("reconciliation_exceptions_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const idempotencyKeys = idempotencyKeysTable;

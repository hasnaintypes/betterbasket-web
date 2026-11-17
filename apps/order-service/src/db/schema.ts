import { outboxTable, processedEventsTable } from "@betterbasket/outbox";
import { idempotencyKeysTable } from "@betterbasket/runtime";
import { sql } from "drizzle-orm";
import {
  char,
  check,
  foreignKey,
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

export const orderStatusEnum = pgEnum("order_status", [
  "awaiting_payment",
  "paid",
  "in_fulfilment",
  "fulfilled",
  "cancelled",
]);
export const refundStatusEnum = pgEnum("order_refund_status", ["none", "partial", "full"]);
export const subOrderStatusEnum = pgEnum("sub_order_status", [
  "awaiting_payment",
  "paid",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerId: text("buyer_id").notNull(),
    status: orderStatusEnum("status").notNull().default("awaiting_payment"),
    refundStatus: refundStatusEnum("refund_status").notNull().default("none"),
    currency: char("currency", { length: 3 }).notNull(),
    subtotal: integer("subtotal").notNull(),
    shippingTotal: integer("shipping_total").notNull(),
    total: integer("total").notNull(),
    shippingAddress: jsonb("shipping_address").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("orders_buyer_created_idx").on(table.buyerId, table.createdAt.desc()),
    check(
      "orders_amounts_nonnegative",
      sql`${table.subtotal} >= 0 AND ${table.shippingTotal} >= 0 AND ${table.total} >= 0`,
    ),
    check(
      "orders_total_matches_parts",
      sql`${table.total} = ${table.subtotal} + ${table.shippingTotal}`,
    ),
    check("orders_currency_uppercase", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("orders_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const subOrders = pgTable(
  "sub_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    sellerId: uuid("seller_id").notNull(),
    status: subOrderStatusEnum("status").notNull().default("awaiting_payment"),
    subtotal: integer("subtotal").notNull(),
    shipping: integer("shipping").notNull(),
    total: integer("total").notNull(),
    commissionBps: integer("commission_bps").notNull(),
    commissionAmount: integer("commission_amount").notNull(),
    sellerNet: integer("seller_net").notNull(),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("sub_orders_id_seller_unique").on(table.id, table.sellerId),
    unique("sub_orders_order_seller_unique").on(table.orderId, table.sellerId),
    index("sub_orders_seller_status_created_idx").on(
      table.sellerId,
      table.status,
      table.createdAt.desc(),
    ),
    index("sub_orders_order_idx").on(table.orderId),
    check(
      "sub_orders_amounts_nonnegative",
      sql`${table.subtotal} >= 0 AND ${table.shipping} >= 0 AND ${table.total} >= 0 AND ${table.commissionAmount} >= 0 AND ${table.sellerNet} >= 0`,
    ),
    check(
      "sub_orders_total_matches_parts",
      sql`${table.total} = ${table.subtotal} + ${table.shipping}`,
    ),
    check(
      "sub_orders_allocation_balanced",
      sql`${table.commissionAmount} + ${table.sellerNet} = ${table.total}`,
    ),
    check("sub_orders_commission_bps_range", sql`${table.commissionBps} BETWEEN 0 AND 10000`),
    check("sub_orders_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subOrderId: uuid("sub_order_id").notNull(),
    sellerId: uuid("seller_id").notNull(),
    productId: text("product_id").notNull(),
    variantId: text("variant_id").notNull(),
    sku: text("sku").notNull(),
    titleSnapshot: text("title_snapshot").notNull(),
    unitPrice: integer("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotal: integer("line_total").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.subOrderId, table.sellerId],
      foreignColumns: [subOrders.id, subOrders.sellerId],
    }),
    index("order_items_sub_order_idx").on(table.subOrderId),
    check(
      "order_items_amounts_valid",
      sql`${table.unitPrice} >= 0 AND ${table.lineTotal} >= 0 AND ${table.quantity} > 0`,
    ),
    check(
      "order_items_line_total_matches",
      sql`${table.lineTotal} = ${table.unitPrice} * ${table.quantity}`,
    ),
  ],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    fromStatus: orderStatusEnum("from_status").notNull(),
    toStatus: orderStatusEnum("to_status").notNull(),
    actorId: text("actor_id"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("order_status_history_order_created_idx").on(table.orderId, table.createdAt.desc()),
  ],
);

export const subOrderStatusHistory = pgTable(
  "sub_order_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subOrderId: uuid("sub_order_id")
      .notNull()
      .references(() => subOrders.id),
    fromStatus: subOrderStatusEnum("from_status").notNull(),
    toStatus: subOrderStatusEnum("to_status").notNull(),
    actorId: text("actor_id").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sub_order_status_history_sub_order_created_idx").on(
      table.subOrderId,
      table.createdAt.desc(),
    ),
  ],
);

export const outbox = outboxTable;
export const processedEvents = processedEventsTable;
export const idempotencyKeys = idempotencyKeysTable;

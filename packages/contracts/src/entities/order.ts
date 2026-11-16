import { z } from "zod";
import { MoneySchema } from "./common.js";

/** Retained for the existing v1 event contract. */
export const LegacyOrderStatusSchema = z.enum([
  "pending",
  "awaiting_payment",
  "paid",
  "fulfilling",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

export const OrderStatusSchema = z.enum([
  "awaiting_payment",
  "paid",
  "in_fulfilment",
  "fulfilled",
  "cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export const SubOrderStatusSchema = z.enum([
  "awaiting_payment",
  "paid",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
]);
export type SubOrderStatus = z.infer<typeof SubOrderStatusSchema>;
export const RefundStatusSchema = z.enum(["none", "partial", "full"]);
export type RefundStatus = z.infer<typeof RefundStatusSchema>;

const id = z.string().trim().min(1).max(128);
const when = z.iso.datetime({ offset: true });

export const ShippingAddressSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(32),
  country: z.string().regex(/^[A-Z]{2}$/, "Use an uppercase ISO 3166-1 alpha-2 country code"),
});
export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;

export const OrderItemSchema = z.object({
  productId: z.string(),
  variantId: z.string().nullish(),
  sellerId: z.string(),
  title: z.string(),
  unitPrice: MoneySchema,
  quantity: z.number().int().positive(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

/** Lives in order-service's Postgres DB. */
export const OrderSchema = z.object({
  id: z.string(),
  buyerId: z.string(),
  items: z.array(OrderItemSchema).min(1),
  subtotal: MoneySchema,
  shippingTotal: MoneySchema,
  total: MoneySchema,
  status: LegacyOrderStatusSchema.default("pending"),
  stripePaymentIntentId: z.string().nullish(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Order = z.infer<typeof OrderSchema>;

export const CreateOrderInputSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        productId: id,
        variantId: id.nullish(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
  shippingAddress: ShippingAddressSchema,
  expectedTotal: MoneySchema.strict().optional(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

export const OrderLineViewSchema = z.strictObject({
  lineId: id,
  productId: id,
  variantId: id.nullish(),
  sellerId: id,
  titleSnapshot: z.string().min(1).max(300),
  sku: z.string().min(1).max(128),
  quantity: z.number().int().min(1).max(99),
  unitPrice: MoneySchema,
  lineTotal: MoneySchema,
});
export type OrderLineView = z.infer<typeof OrderLineViewSchema>;

export const SubOrderViewSchema = z.strictObject({
  id,
  orderId: id,
  sellerId: id,
  status: SubOrderStatusSchema,
  items: z.array(OrderLineViewSchema).min(1).max(50),
  subtotal: MoneySchema,
  shippingTotal: MoneySchema,
  total: MoneySchema,
  createdAt: when,
  updatedAt: when,
});
export type SubOrderView = z.infer<typeof SubOrderViewSchema>;

export const OrderViewSchema = z.strictObject({
  id,
  buyerId: id,
  status: OrderStatusSchema,
  refundStatus: RefundStatusSchema,
  subOrders: z.array(SubOrderViewSchema).min(1).max(50),
  shippingAddress: ShippingAddressSchema,
  subtotal: MoneySchema,
  shippingTotal: MoneySchema,
  total: MoneySchema,
  expiresAt: when,
  createdAt: when,
  updatedAt: when,
});
export type OrderView = z.infer<typeof OrderViewSchema>;

/** Internal order-service response used to create a platform PaymentIntent. */
export const PayableOrderViewSchema = z.strictObject({
  orderId: id,
  buyerId: id,
  status: OrderStatusSchema,
  total: MoneySchema,
  expiresAt: when,
  subOrders: z
    .array(z.strictObject({ id, sellerId: id, total: MoneySchema }))
    .min(1)
    .max(50),
});
export type PayableOrderView = z.infer<typeof PayableOrderViewSchema>;

export const OrderErrorCodes = {
  PRICE_CHANGED: "PRICE_CHANGED",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  REQUEST_IN_PROGRESS: "REQUEST_IN_PROGRESS",
  IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
  SELLER_NOT_ACTIVE: "SELLER_NOT_ACTIVE",
  PRODUCT_NOT_PURCHASABLE: "PRODUCT_NOT_PURCHASABLE",
} as const;

import { z } from "zod";
import { MoneySchema } from "./common.js";

export const OrderStatusSchema = z.enum([
  "pending",
  "awaiting_payment",
  "paid",
  "fulfilling",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderItemSchema = z.object({
  productId: z.string(),
  variantId: z.string().nullish(),
  sellerId: z.string(), // each item can belong to a different seller (multi-vendor cart)
  title: z.string(),
  unitPrice: MoneySchema,
  quantity: z.number().int().positive(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

/** Lives in order-service's Postgres DB. An order may fan out into per-seller sub-orders for payouts. */
export const OrderSchema = z.object({
  id: z.string(),
  buyerId: z.string(),
  items: z.array(OrderItemSchema).min(1),
  subtotal: MoneySchema,
  shippingTotal: MoneySchema,
  total: MoneySchema,
  status: OrderStatusSchema.default("pending"),
  stripePaymentIntentId: z.string().nullish(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Order = z.infer<typeof OrderSchema>;

export const CreateOrderInputSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string().nullish(),
      quantity: z.number().int().positive(),
    }),
  ).min(1),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

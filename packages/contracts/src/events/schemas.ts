import { z } from "zod";
import { MoneySchema } from "../entities/common.js";
import { OrgRoleSchema } from "../entities/common.js";
import { OrderStatusSchema } from "../entities/order.js";
import { Topics } from "./topics.js";

/** Every event on the bus shares this envelope so consumers can log/trace/dedupe generically. */
export const EventEnvelopeSchema = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({
    id: z.string().uuid(), // event id, used for consumer-side idempotency
    occurredAt: z.coerce.date(),
    producer: z.string(), // service name that emitted the event
    payload,
  });

export const UserRegisteredEventSchema = EventEnvelopeSchema(
  z.object({ userId: z.string(), email: z.string().email(), role: z.string() }),
);

export const SellerOnboardedEventSchema = EventEnvelopeSchema(
  z.object({ sellerId: z.string(), organizationId: z.string(), stripeAccountId: z.string() }),
);

export const ProductCreatedEventSchema = EventEnvelopeSchema(
  z.object({ productId: z.string(), sellerId: z.string(), title: z.string() }),
);

export const ProductStockChangedEventSchema = EventEnvelopeSchema(
  z.object({ productId: z.string(), variantId: z.string().nullish(), newStock: z.number().int() }),
);

export const OrderCreatedEventSchema = EventEnvelopeSchema(
  z.object({
    orderId: z.string(),
    buyerId: z.string(),
    total: MoneySchema,
    sellerIds: z.array(z.string()),
  }),
);

export const OrderStatusChangedEventSchema = EventEnvelopeSchema(
  z.object({
    orderId: z.string(),
    previousStatus: OrderStatusSchema,
    newStatus: OrderStatusSchema,
  }),
);

export const PaymentSucceededEventSchema = EventEnvelopeSchema(
  z.object({ orderId: z.string(), paymentId: z.string(), amount: MoneySchema }),
);

export const PaymentFailedEventSchema = EventEnvelopeSchema(
  z.object({ orderId: z.string(), reason: z.string() }),
);

export const PaymentRefundedEventSchema = EventEnvelopeSchema(
  z.object({ orderId: z.string(), paymentId: z.string(), amount: MoneySchema }),
);

export const NotificationRequestedEventSchema = EventEnvelopeSchema(
  z.object({
    userId: z.string(),
    channel: z.enum(["email", "sms", "push"]),
    template: z.string(),
    data: z.record(z.string(), z.unknown()).default({}),
  }),
);

/** Versioned wire envelope. Unknown fields are ignored for forward compatibility. */
export const EventEnvelopeSchemaV2 = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({
    id: z.string().uuid(),
    type: z.string().min(1),
    version: z.number().int().positive(),
    occurredAt: z.coerce.date(),
    producer: z.string().min(1),
    aggregateType: z.string().min(1),
    aggregateId: z.string().min(1),
    aggregateVersion: z.number().int().nonnegative().optional(),
    correlationId: z.string().uuid(),
    causationId: z.string().uuid(),
    traceparent: z.string().optional(),
    payload,
  });

const event = <T extends z.ZodTypeAny>(topic: string, payload: T) => {
  const match = /^(.*)\.v([1-9][0-9]*)$/.exec(topic);
  if (!match) throw new Error(`Invalid topic: ${topic}`);
  return EventEnvelopeSchemaV2(payload).extend({
    type: z.literal(match[1]!),
    version: z.literal(Number(match[2])),
  });
};
const id = z.string().min(1);
const when = z.coerce.date();
const sellerStatus = z.enum([
  "pending",
  "stripe_pending",
  "under_review",
  "active",
  "suspended",
  "closed",
]);
const orderStatusV2 = z.enum([
  "pending",
  "awaiting_payment",
  "paid",
  "fulfilling",
  "shipped",
  "delivered",
  "cancelled",
  "partially_refunded",
  "refunded",
]);
const subOrder = z.object({
  id,
  sellerId: id,
  gross: MoneySchema,
  commission: MoneySchema,
  net: MoneySchema,
});

export const UserRegisteredEventSchemaV2 = event(
  Topics.UserRegistered,
  z.object({ userId: id, email: z.email(), name: z.string().optional(), role: z.string() }),
);
export const UserBannedEventSchema = event(
  Topics.UserBanned,
  z.object({ userId: id, bannedAt: when, expiresAt: when.optional(), reason: z.string().min(1) }),
);
export const OrganizationMemberChangedEventSchema = event(
  Topics.OrganizationMemberChanged,
  z.object({
    organizationId: id,
    userId: id,
    role: OrgRoleSchema.optional(),
    change: z.enum(["added", "updated", "removed"]),
  }),
);
export const SellerOnboardedEventSchemaV2 = event(
  Topics.SellerOnboarded,
  z.object({ sellerId: id, organizationId: id, stripeAccountId: id }),
);
export const SellerStatusChangedEventSchema = event(
  Topics.SellerStatusChanged,
  z.object({
    sellerId: id,
    from: sellerStatus,
    to: sellerStatus,
    reason: z.string().optional(),
    actorId: id,
    effectiveAt: when,
  }),
);
export const StripeAccountUpdatedEventSchema = event(
  Topics.StripeAccountUpdated,
  z.object({
    stripeAccountId: id,
    chargesEnabled: z.boolean(),
    payoutsEnabled: z.boolean(),
    requirementsDue: z.array(z.string()).max(100),
    country: z.string().length(2),
  }),
);
export const ProductCreatedEventSchemaV2 = event(
  Topics.ProductCreated,
  z.object({ productId: id, sellerId: id, title: z.string() }),
);
export const ProductPublishedEventSchema = event(
  Topics.ProductPublished,
  z.object({ productId: id, sellerId: id, publishedAt: when }),
);
export const ProductStockChangedEventSchemaV2 = event(
  Topics.ProductStockChanged,
  z.object({
    productId: id,
    sellerId: id,
    variantId: id.nullish(),
    newStock: z.number().int().nonnegative(),
  }),
);
export const ProductStockReservedEventSchema = event(
  Topics.ProductStockReserved,
  z.object({
    orderId: id,
    productId: id,
    sellerId: id,
    variantId: id.optional(),
    quantity: z.number().int().positive(),
  }),
);
export const ProductStockReleasedEventSchema = event(
  Topics.ProductStockReleased,
  z.object({
    orderId: id,
    productId: id,
    sellerId: id,
    variantId: id.optional(),
    quantity: z.number().int().positive(),
    reason: z.enum(["expired", "cancelled", "failed"]),
  }),
);
export const MediaAssetVerifiedEventSchema = event(
  Topics.MediaAssetVerified,
  z.object({ assetId: id, sellerId: id, url: z.url() }),
);
export const OrderCreatedEventSchemaV2 = event(
  Topics.OrderCreated,
  z.object({
    orderId: id,
    buyerId: id,
    total: MoneySchema,
    sellerIds: z.array(id).min(1).max(100),
    subOrders: z.array(subOrder).min(1).max(100),
    expiresAt: when,
  }),
);
/** @deprecated The v1 status vocabulary is retained for existing consumers. */
export const OrderStatusChangedEventSchemaV1EnvelopeV2 = event(
  Topics.OrderStatusChanged,
  z.object({ orderId: id, previousStatus: OrderStatusSchema, newStatus: OrderStatusSchema }),
);
export const OrderStatusChangedEventSchemaV2 = event(
  Topics.OrderStatusChangedV2,
  z.object({
    orderId: id,
    subOrderId: id.optional(),
    sellerId: id.optional(),
    previousStatus: orderStatusV2,
    newStatus: orderStatusV2,
  }),
);
export const OrderCancelledEventSchema = event(
  Topics.OrderCancelled,
  z.object({
    orderId: id,
    subOrderIds: z.array(id).max(100).optional(),
    reason: z.string().min(1),
    restock: z.boolean(),
  }),
);
export const RefundRequestedEventSchema = event(
  Topics.RefundRequested,
  z.object({
    refundId: id,
    orderId: id,
    subOrderId: id,
    amount: MoneySchema,
    reasonCode: id,
    requestedBy: id,
  }),
);
export const PaymentSucceededEventSchemaV2 = event(
  Topics.PaymentSucceeded,
  z.object({ orderId: id, paymentId: id, amount: MoneySchema }),
);
export const PaymentFailedEventSchemaV2 = event(
  Topics.PaymentFailed,
  z.object({ orderId: id, paymentId: id.optional(), reason: z.string() }),
);
export const PaymentRefundedEventSchemaV2 = event(
  Topics.PaymentRefunded,
  z.object({ orderId: id, paymentId: id, amount: MoneySchema }),
);
const transfer = z.object({ transferId: id, subOrderId: id, sellerId: id, amount: MoneySchema });
export const TransferCreatedEventSchema = event(Topics.TransferCreated, transfer);
export const TransferFailedEventSchema = event(
  Topics.TransferFailed,
  transfer.extend({ reason: z.string().optional() }),
);
export const TransferReversedEventSchema = event(Topics.TransferReversed, transfer);
const dispute = z.object({ orderId: id, disputeId: id, amount: MoneySchema });
export const DisputeOpenedEventSchema = event(Topics.DisputeOpened, dispute);
export const DisputeClosedEventSchema = event(
  Topics.DisputeClosed,
  dispute.extend({ outcome: z.string().optional() }),
);
export const NotificationRequestedEventSchemaV2 = event(
  Topics.NotificationRequested,
  z.object({
    userId: id,
    channel: z.enum(["email", "sms", "push"]),
    template: id,
    data: z.record(z.string(), z.unknown()).default({}),
  }),
);

/** One validator per topic, including the deprecated v1 status topic. */
export const EventSchemaByTopic = {
  [Topics.UserRegistered]: UserRegisteredEventSchemaV2,
  [Topics.UserBanned]: UserBannedEventSchema,
  [Topics.OrganizationMemberChanged]: OrganizationMemberChangedEventSchema,
  [Topics.SellerOnboarded]: SellerOnboardedEventSchemaV2,
  [Topics.SellerStatusChanged]: SellerStatusChangedEventSchema,
  [Topics.StripeAccountUpdated]: StripeAccountUpdatedEventSchema,
  [Topics.ProductCreated]: ProductCreatedEventSchemaV2,
  [Topics.ProductPublished]: ProductPublishedEventSchema,
  [Topics.ProductStockChanged]: ProductStockChangedEventSchemaV2,
  [Topics.ProductStockReserved]: ProductStockReservedEventSchema,
  [Topics.ProductStockReleased]: ProductStockReleasedEventSchema,
  [Topics.MediaAssetVerified]: MediaAssetVerifiedEventSchema,
  [Topics.OrderCreated]: OrderCreatedEventSchemaV2,
  [Topics.OrderStatusChanged]: OrderStatusChangedEventSchemaV1EnvelopeV2,
  [Topics.OrderStatusChangedV2]: OrderStatusChangedEventSchemaV2,
  [Topics.OrderCancelled]: OrderCancelledEventSchema,
  [Topics.RefundRequested]: RefundRequestedEventSchema,
  [Topics.PaymentSucceeded]: PaymentSucceededEventSchemaV2,
  [Topics.PaymentFailed]: PaymentFailedEventSchemaV2,
  [Topics.PaymentRefunded]: PaymentRefundedEventSchemaV2,
  [Topics.TransferCreated]: TransferCreatedEventSchema,
  [Topics.TransferFailed]: TransferFailedEventSchema,
  [Topics.TransferReversed]: TransferReversedEventSchema,
  [Topics.DisputeOpened]: DisputeOpenedEventSchema,
  [Topics.DisputeClosed]: DisputeClosedEventSchema,
  [Topics.NotificationRequested]: NotificationRequestedEventSchemaV2,
} as const;

import { z } from "zod";
import { MoneySchema } from "../entities/common.js";
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

/** Maps each topic to its Zod schema, so `kafka-client` can validate at publish/consume time. */
export const EventSchemaByTopic = {
  [Topics.UserRegistered]: UserRegisteredEventSchema,
  [Topics.SellerOnboarded]: SellerOnboardedEventSchema,
  [Topics.ProductCreated]: ProductCreatedEventSchema,
  [Topics.ProductStockChanged]: ProductStockChangedEventSchema,
  [Topics.OrderCreated]: OrderCreatedEventSchema,
  [Topics.OrderStatusChanged]: OrderStatusChangedEventSchema,
  [Topics.PaymentSucceeded]: PaymentSucceededEventSchema,
  [Topics.PaymentFailed]: PaymentFailedEventSchema,
  [Topics.PaymentRefunded]: PaymentRefundedEventSchema,
  [Topics.NotificationRequested]: NotificationRequestedEventSchema,
} as const;

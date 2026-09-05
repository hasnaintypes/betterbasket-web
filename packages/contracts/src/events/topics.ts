/**
 * Kafka/Redpanda topic names. Versioned in the name (`.v1`) so producers/consumers
 * can evolve payloads without breaking existing consumers (add `.v2` topic instead
 * of mutating `.v1`'s shape).
 */
export const Topics = {
  UserRegistered: "user.registered.v1",
  SellerOnboarded: "seller.onboarded.v1",
  ProductCreated: "product.created.v1",
  ProductStockChanged: "product.stock-changed.v1",
  OrderCreated: "order.created.v1",
  OrderStatusChanged: "order.status-changed.v1",
  PaymentSucceeded: "payment.succeeded.v1",
  PaymentFailed: "payment.failed.v1",
  PaymentRefunded: "payment.refunded.v1",
  NotificationRequested: "notification.requested.v1",
} as const;

export type TopicName = (typeof Topics)[keyof typeof Topics];

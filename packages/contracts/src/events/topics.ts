/**
 * Kafka/Redpanda topic names. Versioned in the name (`.v1`) so producers/consumers
 * can evolve payloads without breaking existing consumers (add `.v2` topic instead
 * of mutating `.v1`'s shape).
 */
export const Topics = {
  UserRegistered: "user.registered.v1",
  UserBanned: "user.banned.v1",
  OrganizationMemberChanged: "organization.member-changed.v1",
  SellerOnboarded: "seller.onboarded.v1",
  SellerStatusChanged: "seller.status-changed.v1",
  StripeAccountUpdated: "stripe.account-updated.v1",
  ProductCreated: "product.created.v1",
  ProductPublished: "product.published.v1",
  ProductStockChanged: "product.stock-changed.v1",
  ProductStockReserved: "product.stock-reserved.v1",
  ProductStockReleased: "product.stock-released.v1",
  MediaAssetVerified: "media.asset-verified.v1",
  OrderCreated: "order.created.v1",
  /** @deprecated Use OrderStatusChangedV2 for new consumers. */
  OrderStatusChanged: "order.status-changed.v1",
  OrderStatusChangedV2: "order.status-changed.v2",
  OrderCancelled: "order.cancelled.v1",
  RefundRequested: "refund.requested.v1",
  PaymentSucceeded: "payment.succeeded.v1",
  PaymentFailed: "payment.failed.v1",
  PaymentRefunded: "payment.refunded.v1",
  TransferCreated: "transfer.created.v1",
  TransferFailed: "transfer.failed.v1",
  TransferReversed: "transfer.reversed.v1",
  DisputeOpened: "dispute.opened.v1",
  DisputeClosed: "dispute.closed.v1",
  NotificationRequested: "notification.requested.v1",
} as const;

export type TopicName = (typeof Topics)[keyof typeof Topics];

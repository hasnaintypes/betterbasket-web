# Contracts compatibility

Every exported Zod schema has a JSON Schema snapshot in `schema-snapshots/`. The snapshots describe accepted input values. Zod 4's built-in JSON Schema conversion generates them; dates are represented as ISO date-time strings. The exporter sorts object keys, required fields, and enum values to avoid ordering-only changes.

After changing a schema, run `pnpm --filter @betterbasket/contracts build` and `pnpm --filter @betterbasket/contracts schemas:export`, then commit the updated snapshots. CI checks that snapshots match the source and compares them with the PR base branch. Removing or renaming a property, changing a type, removing an enum value, or making an optional field required fails the check. Adding an optional field or widening an enum passes.

For an incompatible change, keep the existing schema and topic intact. Export a new `V2Schema` and a `.v2` topic, dual publish while consumers migrate, and remove the old version only after a coordinated migration. A new versioned schema is additive; editing the old version in place still fails the compatibility check.

## Identity claims and capabilities

`AuthTokenClaimsSchema` describes the v2 user JWT: `sub`, `email`,
`emailVerified`, `platformRole`, nullable `orgId` and `orgRole`, `iss`, `aud`,
`iat`, `exp`, and `jti`. `PlatformRoleSchema` accepts only `customer` and
`admin`; a seller is a customer with organization membership and an eligible
seller state. `CapabilitySchema` lists the names that guards will check,
including the `admin:*` capability. Unknown capability names are rejected.

Issue #19 explicitly replaces the old, internal role and claim shape. The
compatibility checker has an exception for the exact before and after hashes
of the three affected snapshots in `scripts/approved-breaking-changes.json`.
Any later breaking edit to those schemas still fails the comparison. Update
the auth issuer and downstream guards together before using v2 JWTs in a
deployed environment.

## Event contracts

`EventSchemaByTopic` validates the v2 wire envelope for every topic. The
envelope contains a UUID `id`, unversioned `type`, numeric `version`,
`occurredAt`, `producer`, `aggregateType`, `aggregateId` (the Kafka partition
key), optional `aggregateVersion`, UUID `correlationId` and `causationId`,
optional `traceparent`, and a topic-specific `payload`. Consumers can ignore
unknown object fields. The previous envelope and schema exports remain for
existing callers; new publishers should use the topic map. The old
`order.status-changed.v1` topic is deprecated in favor of v2 because the status
vocabulary changed.

| Topic family       | Topics and required payload fields                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity           | `user.registered.v1` (`userId`, `email`, `role`); `user.banned.v1` (`userId`, `bannedAt`, `reason`); `organization.member-changed.v1` (`organizationId`, `userId`, `change`)                                                                                                                                                                                                                        |
| Seller and Stripe  | `seller.onboarded.v1` (`sellerId`, `organizationId`, `stripeAccountId`); `seller.status-changed.v1` (`sellerId`, `from`, `to`, `actorId`, `effectiveAt`); `stripe.account-updated.v1` (`stripeAccountId`, `chargesEnabled`, `payoutsEnabled`, `requirementsDue`, `country`)                                                                                                                         |
| Product and media  | `product.created.v1` (`productId`, `sellerId`, `title`); `product.published.v1` (`productId`, `sellerId`, `publishedAt`); `product.stock-changed.v1` (`productId`, `sellerId`, `newStock`); `product.stock-reserved.v1` and `product.stock-released.v1` (`orderId`, `productId`, `sellerId`, `quantity`; released also requires `reason`); `media.asset-verified.v1` (`assetId`, `sellerId`, `url`) |
| Orders and refunds | `order.created.v1` (`orderId`, `buyerId`, `total`, `sellerIds`, `subOrders`, `expiresAt`); `order.status-changed.v1` and `.v2` (`orderId`, `previousStatus`, `newStatus`); `order.cancelled.v1` (`orderId`, `reason`, `restock`); `refund.requested.v1` (`refundId`, `orderId`, `subOrderId`, `amount`, `reasonCode`, `requestedBy`)                                                                |
| Payments           | `payment.succeeded.v1` and `payment.refunded.v1` (`orderId`, `paymentId`, `amount`); `payment.failed.v1` (`orderId`, `reason`); `transfer.created.v1`, `.failed.v1`, `.reversed.v1` (`transferId`, `subOrderId`, `sellerId`, `amount`); `dispute.opened.v1` and `.closed.v1` (`orderId`, `disputeId`, `amount`)                                                                                     |
| Notification       | `notification.requested.v1` (`userId`, `channel`, `template`)                                                                                                                                                                                                                                                                                                                                       |

The sample payloads in `fixtures/events.mjs` are checked against every topic
and each schema's required envelope and payload fields in `scripts/events.test.mjs`.

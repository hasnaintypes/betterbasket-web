# Order-service data model

The service-owned Drizzle migration creates `orders`, `sub_orders`,
`order_items`, `order_status_history`, `outbox`, and `processed_events`.
`orders` contains the buyer, shipping address, totals, expiry, status, and
refund status. Each `sub_orders` row snapshots one seller's subtotal, shipping,
commission rate, commission amount, and net amount. `order_items` snapshots
product identifiers, SKU, title, unit price, quantity, and line total. Seller
visible items carry `seller_id`; a composite foreign key ensures it matches
their sub-order.

The database rejects negative amounts, nonpositive item quantities, nonuppercase
three-letter currencies, inconsistent order and line totals, and sub-order
allocations where commission plus seller net differs from total. Order and
sub-order status values are separate enums. Order creation remains planned;
there is no generic public status mutation endpoint.

`OrdersService.transition(subOrderId, to, actor, reason?)` validates seller
branch transitions against a fixed table. A branch may advance from
`awaiting_payment` to `paid`, `confirmed`, `shipped`, then `delivered`;
`cancelled` is allowed before delivery, including after shipping only for an
admin. Repeating the current target is a no-op. The order status derives from
its branches: all cancelled means cancelled; any awaiting payment keeps the
order awaiting payment; all active branches delivered means fulfilled; any
shipped or delivered branch means in fulfilment; otherwise it is paid.

The transition locks the parent order, compares sub-order status and version,
and writes the new branch status, `sub_order_status_history`, and an
`order.status-changed.v2` outbox event in one transaction. If the derived order
status changes, the same transaction updates the order version and writes
`order_status_history` and another v2 event. History records the actor ID and
optional reason. Callers must authorize the actor before invoking the service.
Invalid transitions return 409 `INVALID_TRANSITION`.

The order-service migration also creates `idempotency_keys` for future
idempotent order creation. The shared runtime store and interceptor manage
claims, replay, and expiry; this service does not yet decorate any route with
`@Idempotent()`.

Apply migrations with a separate migrator role and the direct Postgres URL
before deploying code that uses these tables. The runtime uses the pooled
`DATABASE_URL` with no DDL rights. There is no production data to migrate from
the prototype schema. Check migration metadata with
`pnpm --filter order-service db:check`. The database integration suite uses
`ORDER_TEST_DATABASE_URL` to create and drop a disposable schema; keep that URL
in a secure ignored local setting and run
`pnpm --filter order-service test:integration` against a development database.
The integration command builds the service before loading its transition code.

Do not log the `shipping_address` payload. Buyer reads must filter by
`buyer_id`; seller reads must filter by `seller_id`.

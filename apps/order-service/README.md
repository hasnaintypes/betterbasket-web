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
sub-order status values are separate enums. Status transitions and order
creation are reserved for their planned issues; the old direct status writer
has been removed.

Apply migrations with a separate migrator role and the direct Postgres URL
before deploying code that uses these tables. The runtime uses the pooled
`DATABASE_URL` with no DDL rights. There is no production data to migrate from
the prototype schema. Check migration metadata with
`pnpm --filter order-service db:check`. The database integration suite uses
`ORDER_TEST_DATABASE_URL` to create and drop a disposable schema; keep that URL
in a secure ignored local setting and run
`pnpm --filter order-service test:integration` against a development database.

Do not log the `shipping_address` payload. Buyer reads must filter by
`buyer_id`; seller reads must filter by `seller_id`.

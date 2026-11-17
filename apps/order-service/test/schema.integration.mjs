import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.ORDER_TEST_DATABASE_URL;
if (!url) throw new Error("ORDER_TEST_DATABASE_URL is required for integration tests");
const schema = `order_schema_test_${randomUUID().replaceAll("-", "")}`;
const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
let admin;
let pool;

before(async () => {
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: schema });
});

after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

test("an empty database migrates once and a second migration is a no-op", async () => {
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: schema });
  const result = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 ORDER BY table_name`,
    [schema],
  );
  assert.deepEqual(
    result.rows.map((row) => row.table_name).filter((name) => name !== "__drizzle_migrations"),
    [
      "idempotency_keys",
      "order_items",
      "order_status_history",
      "orders",
      "outbox",
      "processed_events",
      "sub_order_status_history",
      "sub_orders",
    ],
  );
});

test("money, currency, item quantity and seller ownership constraints reject invalid rows", async () => {
  const orderId = randomUUID();
  const sellerId = randomUUID();
  const subOrderId = randomUUID();
  const orderValues = [
    orderId,
    "buyer_test",
    "USD",
    1000,
    100,
    1100,
    JSON.stringify({ city: "Test" }),
  ];
  const insertOrder = `INSERT INTO orders
    (id, buyer_id, currency, subtotal, shipping_total, total, shipping_address, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now() + interval '1 hour')`;
  await pool.query(insertOrder, orderValues);
  await assert.rejects(
    pool.query(insertOrder, [randomUUID(), "buyer_test", "usd", 1000, 100, 1100, "{}"]),
    { code: "23514" },
  );
  await assert.rejects(
    pool.query(insertOrder, [randomUUID(), "buyer_test", "USD", -1, 100, 99, "{}"]),
    { code: "23514" },
  );

  const insertSubOrder = `INSERT INTO sub_orders
    (id, order_id, seller_id, subtotal, shipping, total, commission_bps, commission_amount, seller_net)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
  await assert.rejects(
    pool.query(insertSubOrder, [randomUUID(), orderId, sellerId, 1000, 100, 1100, 1000, 100, 999]),
    { code: "23514", constraint: "sub_orders_allocation_balanced" },
  );
  await pool.query(insertSubOrder, [
    subOrderId,
    orderId,
    sellerId,
    1000,
    100,
    1100,
    1000,
    100,
    1000,
  ]);
  await assert.rejects(
    pool.query(insertSubOrder, [randomUUID(), orderId, sellerId, 1000, 100, 1100, 1000, 100, 1000]),
    { code: "23505", constraint: "sub_orders_order_seller_unique" },
  );

  const insertItem = `INSERT INTO order_items
    (sub_order_id, seller_id, product_id, variant_id, sku, title_snapshot, unit_price, quantity, line_total)
    VALUES ($1, $2, 'product_test', 'variant_test', 'SKU-TEST', 'Test item', 1000, $3, $4)`;
  await assert.rejects(pool.query(insertItem, [subOrderId, sellerId, 0, 0]), { code: "23514" });
  await assert.rejects(pool.query(insertItem, [subOrderId, randomUUID(), 1, 1000]), {
    code: "23503",
  });
  await pool.query(insertItem, [subOrderId, sellerId, 1, 1000]);
});

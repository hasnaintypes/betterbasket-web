import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.ORDER_TEST_DATABASE_URL;
if (!url) throw new Error("ORDER_TEST_DATABASE_URL is required for integration tests");
const schemaName = `order_transition_test_${randomUUID().replaceAll("-", "")}`;
const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
let admin;
let pool;
let transitionSubOrder;
let db;

before(async () => {
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  pool = new Pool({ connectionString: url, options: `-c search_path=${schemaName}`, max: 4 });
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: schemaName });
  const model = await import("../dist/db/schema.js");
  ({ transitionSubOrder } = await import("../dist/orders/transition.js"));
  db = drizzle(pool, { schema: model });
});

after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await admin.end();
  }
});

async function fixture() {
  const orderId = randomUUID();
  const subOrderId = randomUUID();
  await pool.query(
    `INSERT INTO orders
    (id, buyer_id, currency, subtotal, shipping_total, total, shipping_address, expires_at)
    VALUES ($1, 'buyer-test', 'USD', 100, 0, 100, '{}', now() + interval '1 hour')`,
    [orderId],
  );
  await pool.query(
    `INSERT INTO sub_orders
    (id, order_id, seller_id, subtotal, shipping, total, commission_bps, commission_amount, seller_net)
    VALUES ($1, $2, $3, 100, 0, 100, 0, 0, 100)`,
    [subOrderId, orderId, randomUUID()],
  );
  return { orderId, subOrderId };
}

const payment = { id: "payment-service", kind: "payment" };
const seller = { id: "seller-test", kind: "seller" };

test("transition atomically records histories and events; replay is a no-op", async () => {
  const { orderId, subOrderId } = await fixture();
  const first = await transitionSubOrder(db, subOrderId, "paid", payment, "payment succeeded");
  assert.equal(first.orderStatus, "paid");
  assert.deepEqual(await transitionSubOrder(db, subOrderId, "paid", payment), {
    changed: false,
    status: "paid",
  });
  const rows = await pool.query(
    `SELECT
    (SELECT count(*)::int FROM sub_order_status_history WHERE sub_order_id = $1) AS sub_history,
    (SELECT count(*)::int FROM order_status_history WHERE order_id = $2) AS order_history,
    (SELECT count(*)::int FROM outbox WHERE aggregate_id = $2::text) AS events`,
    [subOrderId, orderId],
  );
  assert.deepEqual(rows.rows[0], { sub_history: 1, order_history: 1, events: 2 });
  await assert.rejects(
    transitionSubOrder(db, subOrderId, "delivered", seller),
    (error) => error.status === 409 && error.response.code === "INVALID_TRANSITION",
  );
  const unchanged = await pool.query("SELECT status, version FROM sub_orders WHERE id = $1", [
    subOrderId,
  ]);
  assert.deepEqual(unchanged.rows[0], { status: "paid", version: 1 });
});

test("two competing transitions from confirmed have one winner and one 409", async () => {
  const { subOrderId } = await fixture();
  await transitionSubOrder(db, subOrderId, "paid", payment);
  await transitionSubOrder(db, subOrderId, "confirmed", seller);
  const outcomes = await Promise.allSettled([
    transitionSubOrder(db, subOrderId, "shipped", seller),
    transitionSubOrder(db, subOrderId, "cancelled", seller),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = outcomes.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.status, 409);
  const row = await pool.query("SELECT status, version FROM sub_orders WHERE id = $1", [
    subOrderId,
  ]);
  assert.ok(["shipped", "cancelled"].includes(row.rows[0].status));
  assert.equal(row.rows[0].version, 3);
  const history = await pool.query(
    "SELECT count(*)::int AS count FROM sub_order_status_history WHERE sub_order_id = $1",
    [subOrderId],
  );
  assert.equal(history.rows[0].count, 3);
});

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.PAYMENT_TEST_DATABASE_URL;
if (!url) throw new Error("PAYMENT_TEST_DATABASE_URL is required for integration tests");
const suffix = randomUUID().replaceAll("-", "");
const schema = `payment_schema_test_${suffix}`;
const appRole = `payment_app_test_${suffix}`;
const migratorRole = `payment_migrator_test_${suffix}`;
const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
let admin;
let pool;
let ownerRole;

const quoted = (value) => `"${value.replaceAll('"', '""')}"`;
const table = (name) => `${quoted(schema)}.${quoted(name)}`;

function roleSql(name) {
  return readFileSync(fileURLToPath(new URL(`../sql/${name}`, import.meta.url)), "utf8")
    .replaceAll("payment_migrator", migratorRole)
    .replaceAll("payment_app", appRole)
    .replaceAll("SCHEMA public", `SCHEMA ${quoted(schema)}`)
    .replaceAll("SCHEMA IF NOT EXISTS drizzle", `SCHEMA IF NOT EXISTS ${quoted(schema)}`)
    .replaceAll("SCHEMA drizzle", `SCHEMA ${quoted(schema)}`)
    .replaceAll("drizzle.__drizzle_migrations", `${quoted(schema)}.__drizzle_migrations`)
    .replaceAll("public.", `${quoted(schema)}.`);
}

async function asRole(role, statement, values = []) {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${quoted(role)}`);
    const result = await client.query(statement, values);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

before(async () => {
  admin = new Pool({ connectionString: url });
  ownerRole = (await admin.query("SELECT current_user AS name")).rows[0].name;
  await admin.query(`CREATE SCHEMA ${quoted(schema)}`);
  await admin.query(roleSql("bootstrap_roles.sql"));
  await admin.query(`GRANT ${quoted(appRole)}, ${quoted(migratorRole)} TO ${quoted(ownerRole)}`);
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  await pool.query("CREATE TYPE payment_status AS ENUM ('requires_payment')");
  await pool.query("CREATE TABLE payments (id uuid PRIMARY KEY, status payment_status)");
  await pool.query("CREATE TABLE payout_ledger (id uuid PRIMARY KEY)");
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: schema });
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: schema });
  await admin.query(roleSql("bootstrap_roles.sql"));
  await admin.query(roleSql("grant_runtime.sql"));
});

after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${quoted(schema)} CASCADE`);
    if (ownerRole) {
      await admin.query(
        `REVOKE ${quoted(appRole)}, ${quoted(migratorRole)} FROM ${quoted(ownerRole)}`,
      );
    }
    await admin.query(`DROP ROLE IF EXISTS ${quoted(appRole)}`);
    await admin.query(`DROP ROLE IF EXISTS ${quoted(migratorRole)}`);
    await admin.end();
  }
});

test("migration replaces prototypes and retains webhook tables", async () => {
  const result = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name`,
    [schema],
  );
  const names = result.rows
    .map((row) => row.table_name)
    .filter((name) => name !== "__drizzle_migrations");
  assert.deepEqual(names, [
    "disputes",
    "idempotency_keys",
    "ledger_entries",
    "outbox",
    "payments",
    "processed_events",
    "reconciliation_exceptions",
    "refunds",
    "stripe_events",
    "transfers",
  ]);
  assert.equal(names.includes("payout_ledger"), false);
});

test("app role can insert and read ledger entries, but cannot update, delete, or create tables", async () => {
  const id = randomUUID();
  const insert = `INSERT INTO ${table("ledger_entries")}
    (id, entry_type, debit_account, credit_account, amount, currency,
     provider_object_type, provider_object_id, idempotency_key)
    VALUES ($1, 'charge', 'stripe_clearing', 'seller_payable', 100, 'USD',
      'payment_intent', 'pi_test_1', $2)`;
  await asRole(appRole, insert, [id, `ledger:${id}`]);
  await pool.query(insert, [id, `ledger:${id}`]);
  const read = await asRole(appRole, `SELECT amount FROM ${table("ledger_entries")} WHERE id=$1`, [
    id,
  ]);
  assert.equal(read.rows[0].amount, 100);
  await assert.rejects(
    asRole(appRole, `UPDATE ${table("ledger_entries")} SET amount=1 WHERE id=$1`, [id]),
    { code: "42501" },
  );
  await assert.rejects(
    asRole(appRole, `DELETE FROM ${table("ledger_entries")} WHERE id=$1`, [id]),
    { code: "42501" },
  );
  await assert.rejects(asRole(appRole, `CREATE TABLE ${table("app_ddl_probe")} (id integer)`), {
    code: "42501",
  });
  await asRole(migratorRole, `CREATE TABLE ${table("migrator_ddl_probe")} (id integer)`);
  const journal = await asRole(
    migratorRole,
    `SELECT count(*)::int AS count FROM ${table("__drizzle_migrations")}`,
  );
  assert.equal(journal.rows[0].count, 2);
});

test("ledger uniqueness, amount, currency, and account constraints reject invalid rows", async () => {
  const statement = `INSERT INTO ${table("ledger_entries")}
    (entry_type, debit_account, credit_account, amount, currency,
     provider_object_type, provider_object_id, idempotency_key)
    VALUES ('charge', $1, $2, $3, $4, 'payment_intent', 'pi_test_2', $5)`;
  await pool.query(statement, [
    "stripe_clearing",
    "seller_payable",
    100,
    "USD",
    "unique-ledger-key",
  ]);
  await assert.rejects(
    pool.query(statement, ["stripe_clearing", "seller_payable", 100, "USD", "unique-ledger-key"]),
    { code: "23505", constraint: "ledger_entries_idempotency_key_unique" },
  );
  await assert.rejects(
    pool.query(statement, ["stripe_clearing", "seller_payable", 0, "USD", randomUUID()]),
    { code: "23514", constraint: "ledger_entries_amount_positive" },
  );
  await assert.rejects(
    pool.query(statement, ["stripe_clearing", "seller_payable", 100, "usd", randomUUID()]),
    { code: "23514", constraint: "ledger_entries_currency_uppercase" },
  );
  await assert.rejects(
    pool.query(statement, ["seller_payable", "seller_payable", 100, "USD", randomUUID()]),
    { code: "23514", constraint: "ledger_entries_distinct_accounts" },
  );
});

test("one payment per order and one transfer per sub-order; invalid amounts fail", async () => {
  const orderId = randomUUID();
  const payment = `INSERT INTO ${table("payments")}
    (order_id, stripe_payment_intent_id, amount, currency)
    VALUES ($1, $2, $3, $4)`;
  await pool.query(payment, [orderId, "pi_test_unique", 100, "USD"]);
  await assert.rejects(pool.query(payment, [orderId, "pi_test_other", 100, "USD"]), {
    code: "23505",
    constraint: "payments_order_id_unique",
  });
  await assert.rejects(pool.query(payment, [randomUUID(), "pi_test_unique", 100, "USD"]), {
    code: "23505",
    constraint: "payments_stripe_payment_intent_id_unique",
  });
  await assert.rejects(pool.query(payment, [randomUUID(), "pi_test_negative", -1, "USD"]), {
    code: "23514",
    constraint: "payments_amount_positive",
  });
  const subOrderId = randomUUID();
  const transfer = `INSERT INTO ${table("transfers")}
    (sub_order_id, seller_id, stripe_account_id, amount, currency)
    VALUES ($1, $2, 'acct_test_1', $3, 'USD')`;
  await pool.query(transfer, [subOrderId, randomUUID(), 50]);
  await assert.rejects(pool.query(transfer, [subOrderId, randomUUID(), 50]), {
    code: "23505",
    constraint: "transfers_sub_order_id_unique",
  });
  await assert.rejects(pool.query(transfer, [randomUUID(), randomUUID(), 0]), {
    code: "23514",
    constraint: "transfers_amount_positive",
  });
});

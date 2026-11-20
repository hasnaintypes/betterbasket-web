import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.SELLER_TEST_DATABASE_URL;
if (!url) throw new Error("SELLER_TEST_DATABASE_URL is required for integration tests");
const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
const schemas = ["seller_fresh", "seller_upgrade"].map(
  (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
);
let admin;

before(async () => {
  admin = new Pool({ connectionString: url });
  for (const schema of schemas) await admin.query(`CREATE SCHEMA ${schema}`);
});

after(async () => {
  if (admin) {
    for (const schema of schemas) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

function poolFor(schema) {
  return new Pool({ connectionString: url, options: `-c search_path=${schema}` });
}

async function assertTables(pool) {
  const result = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`,
  );
  const names = result.rows.map((row) => row.tablename);
  for (const name of [
    "sellers",
    "seller_members",
    "seller_status_history",
    "outbox",
    "processed_events",
  ])
    assert.ok(names.includes(name), `${name} exists`);
}

test("migration builds an empty schema and enforces slug and membership constraints", async () => {
  const pool = poolFor(schemas[0]);
  try {
    await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: schemas[0] });
    await assertTables(pool);
    const seller = await pool.query(
      "INSERT INTO sellers (organization_id, store_name, slug, status, approved_at) VALUES ('org-1', 'Test', 'test-1', 'active', now()) RETURNING id",
    );
    const sellerId = seller.rows[0].id;
    await assert.rejects(
      pool.query("UPDATE sellers SET slug='changed' WHERE id=$1", [sellerId]),
      (error) => error.code === "23514",
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO sellers (organization_id, store_name, slug) VALUES ('org-2','Test','test-1')",
      ),
      (error) => error.code === "23505",
    );
    await pool.query(
      "INSERT INTO seller_members (seller_id, user_id, role) VALUES ($1,'user-1','owner')",
      [sellerId],
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO seller_members (seller_id, user_id, role) VALUES ($1,'user-1','owner')",
        [sellerId],
      ),
      (error) => error.code === "23505",
    );
    await pool.query(
      "INSERT INTO seller_status_history (seller_id, from_status, to_status) VALUES ($1,'under_review','active')",
      [sellerId],
    );
  } finally {
    await pool.end();
  }
});

test("migration upgrades the previous seller table without losing rows", async () => {
  const pool = poolFor(schemas[1]);
  try {
    await pool.query(
      "CREATE TYPE seller_status AS ENUM ('pending','stripe_pending','active','suspended')",
    );
    await pool.query(`CREATE TABLE sellers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL UNIQUE,
      store_name text NOT NULL, slug text NOT NULL UNIQUE, description text, logo_url text,
      stripe_account_id text, status seller_status NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query(
      "INSERT INTO sellers (organization_id,store_name,slug,status) VALUES ('old-org','Old','old-slug','active')",
    );
    await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: schemas[1] });
    await assertTables(pool);
    const result = await pool.query(
      "SELECT country, support_email, approved_by, approved_at, suspended_reason, version FROM sellers WHERE organization_id='old-org'",
    );
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].version, 0);
    await assert.rejects(
      pool.query("UPDATE sellers SET slug='new-slug' WHERE organization_id='old-org'"),
      (error) => error.code === "23514",
    );
  } finally {
    await pool.end();
  }
});

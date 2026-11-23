import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.SELLER_TEST_DATABASE_URL;
if (!url) throw new Error("SELLER_TEST_DATABASE_URL is required for integration tests");
const schema = `seller_onboard_${randomUUID().replaceAll("-", "")}`;
const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
const input = {
  storeName: "Test Store",
  slug: "test-store",
  country: "US",
  supportEmail: "support@example.test",
};
let admin;
let pool;
let service;

before(async () => {
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const runtimeUrl = new URL(url);
  runtimeUrl.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = runtimeUrl.toString();
  process.env.NODE_ENV = "test";
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: schema });
  const { SellersService } = await import("../dist/sellers/sellers.service.js");
  service = new SellersService();
});

after(async () => {
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

test("concurrent owner retries create exactly one pending seller without a Stripe account", async () => {
  const [first, second] = await Promise.all([
    service.onboard("org-1", input),
    service.onboard("org-1", input),
  ]);
  assert.deepEqual(first, second);
  assert.equal(first.status, "pending");
  const rows = await pool.query(
    "SELECT id, status, stripe_account_id, country, support_email FROM sellers WHERE organization_id=$1",
    ["org-1"],
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].stripe_account_id, null);
  assert.equal(rows.rows[0].country, "US");
  assert.equal(rows.rows[0].support_email, "support@example.test");
});

test("country allow-list denies new unsupported registrations outside test mode", async () => {
  process.env.NODE_ENV = "production";
  process.env.SUPPORTED_SELLER_COUNTRIES = "US,CA";
  try {
    await assert.rejects(service.onboard("org-2", { ...input, country: "GB" }), {
      status: 400,
    });
    const rows = await pool.query("SELECT id FROM sellers WHERE organization_id=$1", ["org-2"]);
    assert.equal(rows.rowCount, 0);
  } finally {
    process.env.NODE_ENV = "test";
    delete process.env.SUPPORTED_SELLER_COUNTRIES;
  }
});

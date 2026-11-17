import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const require = createRequire(import.meta.url);
const {
  IdempotencyStore,
  IdempotencyKeyReusedError,
  RequestInProgressError,
  requestBodyHash,
} = require("@betterbasket/runtime");
const url = process.env.ORDER_TEST_DATABASE_URL;
if (!url) throw new Error("ORDER_TEST_DATABASE_URL is required for integration tests");
const schema = `order_idempotency_test_${randomUUID().replaceAll("-", "")}`;
const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
let admin;
let pool;
let store;

before(async () => {
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 8 });
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: schema });
  store = new IdempotencyStore(pool);
});

after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

test("same key and body replay exactly; changed body gets 422 semantics", async () => {
  const key = randomUUID();
  const scope = JSON.stringify(["buyer-1", "POST", "/orders"]);
  const hash = requestBodyHash({ a: 1, b: 2 });
  let calls = 0;
  const handler = async () => {
    calls++;
    return { status: 201, body: { id: "order-1" }, requestId: randomUUID() };
  };
  const first = await store.execute(scope, key, hash, handler);
  const replay = await store.execute(scope, key, requestBodyHash({ b: 2, a: 1 }), handler);
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(calls, 1);
  await assert.rejects(
    store.execute(scope, key, requestBodyHash({ a: 2 }), handler),
    IdempotencyKeyReusedError,
  );
  const otherScope = await store.execute(
    JSON.stringify(["buyer-2", "POST", "/orders"]),
    key,
    hash,
    handler,
  );
  assert.equal(otherScope.replayed, false);
  assert.equal(calls, 2);
});

test("parallel identical requests execute once; a pending request returns 409 semantics", async () => {
  const key = randomUUID();
  const hash = requestBodyHash({ item: 1 });
  const scope = "buyer-1:POST:/orders:parallel";
  let enter;
  let release;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let executions = 0;
  const first = store.execute(scope, key, hash, async () => {
    executions++;
    enter();
    await gate;
    return { status: 201, body: { id: "order-parallel" } };
  });
  await entered;
  try {
    await assert.rejects(
      store.execute(scope, key, hash, async () => {
        executions++;
        return { status: 201, body: { id: "duplicate" } };
      }),
      RequestInProgressError,
    );
  } finally {
    release();
  }
  const completed = await first;
  const replay = await store.execute(scope, key, hash, async () => {
    executions++;
  });
  assert.equal(executions, 1);
  assert.deepEqual(replay, { ...completed, replayed: true });
});

test("4xx is stored, 5xx is retried, and an expired pending claim can be reclaimed", async () => {
  const hash = requestBodyHash({ item: 2 });
  const scope = "buyer-1:POST:/orders:errors";
  const badKey = randomUUID();
  const bad = await store.execute(scope, badKey, hash, async () => ({
    status: 400,
    body: { error: "bad" },
  }));
  assert.deepEqual(
    await store.execute(scope, badKey, hash, async () => {
      throw new Error("replayed handler");
    }),
    { ...bad, replayed: true },
  );

  const failedKey = randomUUID();
  await store.execute(scope, failedKey, hash, async () => ({
    status: 503,
    body: { error: "retry" },
  }));
  const retried = await store.execute(scope, failedKey, hash, async () => ({
    status: 201,
    body: { ok: true },
  }));
  assert.equal(retried.replayed, false);

  const thrownKey = randomUUID();
  await assert.rejects(
    store.execute(scope, thrownKey, hash, async () => {
      throw new Error("handler failed");
    }),
    /handler failed/,
  );
  const retriedAfterThrow = await store.execute(scope, thrownKey, hash, async () => ({
    status: 201,
    body: { ok: true },
  }));
  assert.equal(retriedAfterThrow.replayed, false);

  const crashedKey = randomUUID();
  await pool.query(
    `INSERT INTO idempotency_keys
    (scope, key, request_hash, expires_at, in_progress_until, owner_id)
    VALUES ($1, $2, $3, now() + interval '1 day', now() - interval '1 second', $4)`,
    [scope, crashedKey, hash, randomUUID()],
  );
  const recovered = await store.execute(scope, crashedKey, hash, async () => ({
    status: 201,
    body: { recovered: true },
  }));
  assert.equal(recovered.body.recovered, true);
});

test("cleanup removes expired rows in bounded batches", async () => {
  const scope = "buyer-1:POST:/orders:cleanup";
  const hash = requestBodyHash({ item: 3 });
  const keys = [randomUUID(), randomUUID()];
  for (const key of keys) {
    await store.execute(scope, key, hash, async () => ({ status: 201, body: { ok: true } }));
  }
  await pool.query(
    `UPDATE idempotency_keys SET expires_at = now() - interval '1 second'
    WHERE scope = $1`,
    [scope],
  );
  assert.equal(await store.cleanupExpired(1), 1);
  assert.equal(await store.cleanupExpired(1), 1);
  assert.equal(await store.cleanupExpired(1), 0);
});

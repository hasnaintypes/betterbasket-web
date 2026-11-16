import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { OutboxRelay, OutboxWriter } from "../dist/index.js";

const url =
  process.env.OUTBOX_TEST_DATABASE_URL ??
  (process.env.OUTBOX_ALLOW_DEV_TEST === "1" ? process.env.DIRECT_DATABASE_URL : undefined);
if (!url) throw new Error("OUTBOX_TEST_DATABASE_URL is required for integration tests");
const schema = `outbox_test_${randomUUID().replaceAll("-", "")}`;
let admin;
let pool;

before(async () => {
  if (!url) return;
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  await pool.query(`CREATE TABLE outbox (
    id uuid PRIMARY KEY, aggregate_type text NOT NULL, aggregate_id text NOT NULL,
    type text NOT NULL, version integer NOT NULL, payload jsonb NOT NULL,
    headers jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    published_at timestamptz, attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(), quarantined_at timestamptz)`);
});
after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
beforeEach(async () => {
  if (pool) await pool.query("TRUNCATE outbox");
});

function event(aggregateId = randomUUID()) {
  return {
    id: randomUUID(),
    type: "user.banned",
    version: 1,
    occurredAt: new Date(),
    producer: "test",
    aggregateType: "user",
    aggregateId,
    correlationId: randomUUID(),
    causationId: randomUUID(),
    payload: { userId: aggregateId, bannedAt: new Date(), reason: "test" },
  };
}

test("writer follows caller commit and rollback", async () => {
  const db = drizzle(pool);
  const rolledBack = event();
  await assert.rejects(
    db.transaction(async (tx) => {
      await OutboxWriter.add(tx, rolledBack);
      throw new Error("rollback");
    }),
  );
  assert.equal(
    (await pool.query("SELECT id FROM outbox WHERE id=$1", [rolledBack.id])).rowCount,
    0,
  );
  const committed = event();
  await db.transaction(async (tx) => OutboxWriter.add(tx, committed));
  assert.equal((await pool.query("SELECT id FROM outbox WHERE id=$1", [committed.id])).rowCount, 1);
  await assert.rejects(
    db.transaction(async (tx) => OutboxWriter.add(tx, { ...event(), payload: {} })),
  );
  await assert.rejects(
    db.transaction(async (tx) =>
      OutboxWriter.add(tx, {
        ...event(),
        payload: { userId: "x", bannedAt: new Date(), reason: "x".repeat(300_000) },
      }),
    ),
  );
});

test("concurrent relays preserve aggregate order and cannot share a lock", {}, async () => {
  const db = drizzle(pool);
  const key = randomUUID();
  const first = event(key);
  const second = event(key);
  await db.transaction(async (tx) => {
    await OutboxWriter.add(tx, first);
    await OutboxWriter.add(tx, second);
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const seen = [];
  const relayA = new OutboxRelay(pool, async (message) => {
    seen.push(JSON.parse(message.value).id);
    entered();
    await gate;
  });
  const relayB = new OutboxRelay(pool, async (message) => {
    seen.push(JSON.parse(message.value).id);
  });
  const pending = relayA.runBatch();
  await started;
  assert.equal(await relayB.runBatch(), 0);
  release();
  await pending;
  assert.equal(await relayB.runBatch(), 1);
  assert.deepEqual(seen, [first.id, second.id]);
});

test("ack before mark can replay the same event id", async () => {
  const db = drizzle(pool);
  const item = event();
  await db.transaction(async (tx) => OutboxWriter.add(tx, item));
  const seen = [];
  const crash = new OutboxRelay(pool, async (message) => {
    seen.push(JSON.parse(message.value).id);
    throw new Error("simulated crash after broker ack");
  });
  await crash.runBatch();
  assert.equal(
    (await pool.query("SELECT attempts FROM outbox WHERE id=$1", [item.id])).rows[0].attempts,
    1,
  );
  await pool.query("UPDATE outbox SET next_attempt_at = now() WHERE id=$1", [item.id]);
  const restarted = new OutboxRelay(pool, async (message) => {
    seen.push(JSON.parse(message.value).id);
  });
  await restarted.runBatch();
  assert.deepEqual(seen, [item.id, item.id]);
  assert.equal(
    (await pool.query("SELECT published_at IS NOT NULL AS done FROM outbox WHERE id=$1", [item.id]))
      .rows[0].done,
    true,
  );
});

test("poison rows quarantine at 20 attempts and published rows purge after seven days", async () => {
  const db = drizzle(pool);
  const poison = event();
  await db.transaction(async (tx) => OutboxWriter.add(tx, poison));
  await pool.query("UPDATE outbox SET attempts=19 WHERE id=$1", [poison.id]);
  const quarantined = [];
  const relay = new OutboxRelay(
    pool,
    async () => {
      throw new Error("broker unavailable");
    },
    {
      onQuarantine: (id) => quarantined.push(id),
    },
  );
  await relay.runBatch();
  const result = await pool.query(
    "SELECT attempts, quarantined_at IS NOT NULL AS quarantined FROM outbox WHERE id=$1",
    [poison.id],
  );
  assert.equal(result.rows[0].attempts, 20);
  assert.equal(result.rows[0].quarantined, true);
  assert.deepEqual(quarantined, [poison.id]);
  assert.equal(await relay.oldestUnpublishedAgeSeconds(), null);

  const old = event();
  await db.transaction(async (tx) => OutboxWriter.add(tx, old));
  await pool.query("UPDATE outbox SET published_at=now()-interval '8 days' WHERE id=$1", [old.id]);
  assert.equal(await relay.purgePublished(), 1);
  assert.equal((await pool.query("SELECT id FROM outbox WHERE id=$1", [old.id])).rowCount, 0);
});

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Inbox, purgeProcessedEvents } from "../dist/index.js";

const url =
  process.env.OUTBOX_TEST_DATABASE_URL ??
  (process.env.OUTBOX_ALLOW_DEV_TEST === "1" ? process.env.DIRECT_DATABASE_URL : undefined);
if (!url) throw new Error("OUTBOX_TEST_DATABASE_URL is required for integration tests");
const schema = `inbox_test_${randomUUID().replaceAll("-", "")}`;
let admin;
let pool;
let inbox;

before(async () => {
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  await pool.query(`CREATE TABLE processed_events (
    consumer text NOT NULL, event_id uuid NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id))`);
  await pool.query("CREATE TABLE effects (event_id uuid PRIMARY KEY, count integer NOT NULL)");
  inbox = new Inbox(drizzle(pool));
});

after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

beforeEach(async () => {
  await pool.query("TRUNCATE processed_events, effects");
});

const consumer = "dev.order.payments";

test("concurrent duplicates apply one effect", async () => {
  const eventId = randomUUID();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const first = inbox.run({ consumer, eventId }, async (tx) => {
    entered();
    await gate;
    await tx.execute(sql`INSERT INTO effects (event_id, count) VALUES (${eventId}, 1)`);
    return "applied";
  });
  await started;
  const second = inbox.run({ consumer, eventId }, async () => {
    throw new Error("duplicate handler must not run");
  });
  release();
  assert.deepEqual(await first, { processed: true, value: "applied" });
  assert.deepEqual(await second, { processed: false });
  assert.equal((await pool.query("SELECT count FROM effects WHERE event_id=$1", [eventId])).rows[0].count, 1);
});

test("handler failure rolls back claim and effect so delivery can retry", async () => {
  const eventId = randomUUID();
  await assert.rejects(inbox.run({ consumer, eventId }, async (tx) => {
    await tx.execute(sql`INSERT INTO effects (event_id, count) VALUES (${eventId}, 1)`);
    throw new Error("handler failed");
  }));
  assert.equal((await pool.query("SELECT * FROM processed_events WHERE event_id=$1", [eventId])).rowCount, 0);
  assert.equal((await pool.query("SELECT * FROM effects WHERE event_id=$1", [eventId])).rowCount, 0);
  assert.deepEqual(await inbox.run({ consumer, eventId }, async () => "retried"),
    { processed: true, value: "retried" });
});

test("consumer namespace is part of the dedupe key", async () => {
  const eventId = randomUUID();
  assert.equal((await inbox.run({ consumer, eventId }, async () => 1)).processed, true);
  assert.equal((await inbox.run({ consumer: "dev.order.audit", eventId }, async () => 2)).processed, true);
  assert.equal((await pool.query("SELECT * FROM processed_events WHERE event_id=$1", [eventId])).rowCount, 2);
  await assert.rejects(inbox.run({ consumer: "invalid", eventId }, async () => 3));
});

test("retention removes only rows older than fourteen days", async () => {
  const oldId = randomUUID();
  const recentId = randomUUID();
  await pool.query("INSERT INTO processed_events (consumer, event_id, processed_at) VALUES ($1,$2,now()-interval '15 days'),($1,$3,now()-interval '13 days')", [consumer, oldId, recentId]);
  assert.equal(await purgeProcessedEvents(drizzle(pool)), 1);
  assert.equal((await pool.query("SELECT * FROM processed_events WHERE event_id=$1", [oldId])).rowCount, 0);
  assert.equal((await pool.query("SELECT * FROM processed_events WHERE event_id=$1", [recentId])).rowCount, 1);
});

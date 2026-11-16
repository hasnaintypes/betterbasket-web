import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const require = createRequire(import.meta.url);
const { Test } = require("@nestjs/testing");
const request = require("supertest");
const Stripe = require("stripe");
const { WebhookController } = require("../dist/payments/webhook.controller.js");
const { StripeProvider } = require("../dist/payments/stripe.provider.js");
const {
  StripeProcessorRegistry,
  StripeWebhookInbox,
} = require("../dist/payments/webhook.inbox.js");

const url = process.env.PAYMENT_TEST_DATABASE_URL;
if (!url) throw new Error("PAYMENT_TEST_DATABASE_URL is required for integration tests");
const schema = `payment_webhook_test_${randomUUID().replaceAll("-", "")}`;
const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
const accountSecret = "whsec_account_test_fixture";
const connectSecret = "whsec_connect_test_fixture";
const stripe = new Stripe("sk_test_aaaaaaaaaaaaaaaaaaaa");
let admin;
let pool;
let app;
let registry;
let inbox;

before(async () => {
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: schema });
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "4005",
    AUTH_SERVICE_URL: "http://127.0.0.1:4001",
    DATABASE_URL: "postgresql://user:password@db.example.test/db",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa",
    STRIPE_ACCOUNT_WEBHOOK_SECRET: accountSecret,
    STRIPE_CONNECT_WEBHOOK_SECRET: connectSecret,
    PAYMENTS_LIVE_MODE_ENABLED: "false",
    PLATFORM_FEE_BPS: "1000",
    KAFKA_BROKERS: "broker.example.test:9092",
    KAFKA_USERNAME: "user",
    KAFKA_PASSWORD: "password",
    KAFKA_TOPIC_PREFIX: "test.",
  });
  registry = new StripeProcessorRegistry();
  inbox = new StripeWebhookInbox(new StripeProvider(), registry, pool);
  const module = await Test.createTestingModule({
    controllers: [WebhookController],
    providers: [{ provide: StripeWebhookInbox, useValue: inbox }],
  }).compile();
  app = module.createNestApplication({ rawBody: true });
  await app.init();
});

after(async () => {
  await app?.close();
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

beforeEach(async () => {
  if (pool) await pool.query("TRUNCATE stripe_events");
});

function signedEvent(
  secret,
  type = "unhandled.example",
  id = `evt_${randomUUID().replaceAll("-", "")}`,
) {
  const raw = JSON.stringify({ id, object: "event", type, data: { object: { id: "obj_test" } } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload: raw, secret });
  return { id, raw, signature };
}

test("signed duplicates return 200 and store one event", async () => {
  const event = signedEvent(accountSecret);
  for (let delivery = 0; delivery < 2; delivery++) {
    const response = await request(app.getHttpServer())
      .post("/payments/webhook/account")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", event.signature)
      .send(event.raw);
    assert.equal(response.status, 200);
  }
  const result = await pool.query(
    "SELECT scope, status, count(*) OVER () AS total FROM stripe_events WHERE event_id=$1",
    [event.id],
  );
  assert.equal(result.rowCount, 1);
  assert.deepEqual(
    [result.rows[0].scope, result.rows[0].status, result.rows[0].total],
    ["account", "processed", "1"],
  );
  assert.equal(
    (await request(app.getHttpServer()).post("/payments/webhook").send(event.raw)).status,
    404,
  );
});

test("each scope uses its own secret and a bad signature stores nothing", async () => {
  const event = signedEvent(connectSecret, "account.updated");
  const wrongScope = await request(app.getHttpServer())
    .post("/payments/webhook/account")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", event.signature)
    .send(event.raw);
  assert.equal(wrongScope.status, 400);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS total FROM stripe_events")).rows[0].total,
    0,
  );
  const accepted = await request(app.getHttpServer())
    .post("/payments/webhook/connect")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", event.signature)
    .send(event.raw);
  assert.equal(accepted.status, 200);
});

test("processor failure records failed status and retry applies one effect", async () => {
  await pool.query("CREATE TABLE IF NOT EXISTS test_effects (event_id text PRIMARY KEY)");
  await pool.query("TRUNCATE test_effects");
  let attempts = 0;
  registry.register({
    scope: "account",
    type: "payment_intent.succeeded",
    async process(event, client) {
      attempts++;
      await client.query("INSERT INTO test_effects (event_id) VALUES ($1)", [event.id]);
      if (attempts === 1) throw new Error("test failure");
    },
  });
  const event = signedEvent(accountSecret, "payment_intent.succeeded");
  const first = await request(app.getHttpServer())
    .post("/payments/webhook/account")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", event.signature)
    .send(event.raw);
  assert.equal(first.status, 500);
  assert.equal(
    (await pool.query("SELECT status FROM stripe_events WHERE event_id=$1", [event.id])).rows[0]
      .status,
    "failed",
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS total FROM test_effects")).rows[0].total,
    0,
  );
  assert.equal(await inbox.retryPending(), 1);
  assert.equal(
    (await pool.query("SELECT status FROM stripe_events WHERE event_id=$1", [event.id])).rows[0]
      .status,
    "processed",
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS total FROM test_effects")).rows[0].total,
    1,
  );
});

test("retention removes only processed events older than 90 days", async () => {
  const old = signedEvent(accountSecret);
  await inbox.receive(Buffer.from(old.raw), old.signature, "account");
  await pool.query(
    "UPDATE stripe_events SET processed_at=now()-interval '91 days' WHERE event_id=$1",
    [old.id],
  );
  assert.equal(await inbox.purgeProcessed(), 1);
  assert.equal(
    (await pool.query("SELECT event_id FROM stripe_events WHERE event_id=$1", [old.id])).rowCount,
    0,
  );
});

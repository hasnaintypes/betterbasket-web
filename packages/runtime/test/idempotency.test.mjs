import "reflect-metadata";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import request from "supertest";
import pino from "pino";
import { NestFactory } from "@nestjs/core";

const require = createRequire(import.meta.url);
const { Body, Controller, Module, Param, Post, BadRequestException } = require("@nestjs/common");
const { APP_FILTER, APP_INTERCEPTOR } = require("@nestjs/core");
const {
  AllExceptionsFilter,
  Idempotent,
  IdempotencyInterceptor,
  IdempotencyStore,
  IdempotencyKeyReusedError,
  RequestInProgressError,
  RequestIdMiddleware,
  REQUEST_LOGGER,
  requestBodyHash,
} = require("../dist/index.js");

let calls = 0;
class ExampleController {
  mutate(body) {
    calls++;
    if (body.fail) throw new BadRequestException("unsafe internal detail");
    return { value: body.value, calls };
  }
  mutateResource(id, body) {
    calls++;
    return { id, value: body.value, calls };
  }
}
Controller("idempotency")(ExampleController);
const descriptor = Object.getOwnPropertyDescriptor(ExampleController.prototype, "mutate");
Post("mutate")(ExampleController.prototype, "mutate", descriptor);
Idempotent()(ExampleController.prototype, "mutate", descriptor);
Body()(ExampleController.prototype, "mutate", 0);
const resourceDescriptor = Object.getOwnPropertyDescriptor(
  ExampleController.prototype,
  "mutateResource",
);
Post("resource/:id")(ExampleController.prototype, "mutateResource", resourceDescriptor);
Idempotent()(ExampleController.prototype, "mutateResource", resourceDescriptor);
Param("id")(ExampleController.prototype, "mutateResource", 0);
Body()(ExampleController.prototype, "mutateResource", 1);

const results = new Map();
const store = {
  async execute(scope, key, hash, handler) {
    const identity = JSON.stringify([scope, key]);
    const existing = results.get(identity);
    if (existing) {
      if (existing.hash !== hash) throw new IdempotencyKeyReusedError();
      return { ...existing.result, replayed: true };
    }
    const result = await handler();
    results.set(identity, { hash, result });
    return { ...result, replayed: false };
  },
};
const logger = pino({ level: "silent" });
class ExampleModule {
  configure(consumer) {
    consumer
      .apply(RequestIdMiddleware, (req, _res, next) => {
        req.user = { sub: req.headers["x-test-user"] ?? "buyer-1" };
        next();
      })
      .forRoutes("*");
  }
}
Module({
  controllers: [ExampleController],
  providers: [
    { provide: REQUEST_LOGGER, useValue: logger },
    { provide: IdempotencyStore, useValue: store },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})(ExampleModule);

let app;
before(async () => {
  app = await NestFactory.create(ExampleModule, { logger: false });
  await app.init();
});
after(async () => app?.close());

test("canonical body hash ignores object key order but preserves array order", () => {
  assert.equal(requestBodyHash({ b: 2, a: [1, 2] }), requestBodyHash({ a: [1, 2], b: 2 }));
  assert.notEqual(requestBodyHash({ a: [1, 2] }), requestBodyHash({ a: [2, 1] }));
});

test("decorated route requires a UUID key and an unchanged body replays status and body", async () => {
  const missing = await request(app.getHttpServer()).post("/idempotency/mutate").send({ value: 1 });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, "VALIDATION_FAILED");
  const key = randomUUID();
  const first = await request(app.getHttpServer())
    .post("/idempotency/mutate")
    .set("Idempotency-Key", key)
    .send({ value: 1 });
  const replay = await request(app.getHttpServer())
    .post("/idempotency/mutate")
    .set("Idempotency-Key", key)
    .send({ value: 1 });
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, first.body);
  assert.equal(calls, 1);
  assert.equal(replay.headers["x-request-id"], first.headers["x-request-id"]);
  const mismatch = await request(app.getHttpServer())
    .post("/idempotency/mutate")
    .set("Idempotency-Key", key)
    .send({ value: 2 });
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body.error.code, "IDEMPOTENCY_KEY_REUSED");
  const otherUser = await request(app.getHttpServer())
    .post("/idempotency/mutate")
    .set("Idempotency-Key", key)
    .set("X-Test-User", "buyer-2")
    .send({ value: 1 });
  assert.equal(otherUser.status, 201);
  assert.equal(calls, 2);
});

test("4xx results replay the exact envelope", async () => {
  const key = randomUUID();
  const first = await request(app.getHttpServer())
    .post("/idempotency/mutate")
    .set("Idempotency-Key", key)
    .send({ fail: true });
  const replay = await request(app.getHttpServer())
    .post("/idempotency/mutate")
    .set("Idempotency-Key", key)
    .send({ fail: true });
  assert.equal(first.status, 400);
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.status, first.status);
  assert.equal(replay.headers["x-request-id"], first.headers["x-request-id"]);
  assert.doesNotMatch(JSON.stringify(first.body), /unsafe internal detail/);
  assert.equal(calls, 3);
});

test("scope includes the concrete resource path", async () => {
  const key = randomUUID();
  const first = await request(app.getHttpServer())
    .post("/idempotency/resource/one")
    .set("Idempotency-Key", key)
    .send({ value: 4 });
  const second = await request(app.getHttpServer())
    .post("/idempotency/resource/two")
    .set("Idempotency-Key", key)
    .send({ value: 4 });
  assert.equal(first.body.id, "one");
  assert.equal(second.body.id, "two");
  assert.equal(calls, 5);
});

test("in-flight errors map to 409", async () => {
  const key = randomUUID();
  const original = store.execute;
  store.execute = async () => {
    throw new RequestInProgressError();
  };
  try {
    const result = await request(app.getHttpServer())
      .post("/idempotency/mutate")
      .set("Idempotency-Key", key)
      .send({ value: 3 });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "REQUEST_IN_PROGRESS");
  } finally {
    store.execute = original;
  }
});

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { SampleModule, logger, logLines } from "./sample.module.mjs";

const require = createRequire(import.meta.url);
const {
  AllExceptionsFilter,
  RequestIdMiddleware,
  getRequestId,
  acceptedRequestId,
} = require("../dist/index.js");
let app;

before(async () => {
  app = await NestFactory.create(SampleModule, { logger: false });
  await app.init();
});
after(async () => {
  await app?.close();
});

test("invalid nested body returns validation envelope and request id", async () => {
  const response = await request(app.getHttpServer())
    .post("/sample/validate")
    .send({ items: [{ name: "" }] });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_FAILED");
  assert.deepEqual(response.body.error.details, [
    { field: "/items/0/name", issue: "Invalid value" },
  ]);
  assert.match(response.body.error.requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(response.headers["x-request-id"], response.body.error.requestId);
});

test("unknown error is redacted in the response and logged with request id", async () => {
  const response = await request(app.getHttpServer()).get("/sample/crash");
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(response.body), /server-secret-stack-marker|stack/);
  assert.ok(
    logLines.some(
      (line) =>
        line.requestId === response.body.error.requestId &&
        line.err?.message === "server-secret-stack-marker",
    ),
  );
});

test("accepted UUID is echoed; HTTP and Zod errors are mapped safely", async () => {
  const id = "8aa18f80-401f-42f2-97b3-fb6e68fe8e1b";
  const good = await request(app.getHttpServer())
    .post("/sample/validate")
    .set("X-Request-Id", id)
    .send({ items: [{ name: "ok" }] });
  assert.equal(good.status, 201);
  assert.equal(good.headers["x-request-id"], id);
  const bad = await request(app.getHttpServer()).get("/sample/bad-request");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "MALFORMED_REQUEST");
  assert.doesNotMatch(JSON.stringify(bad.body), /raw-secret-marker/);
  const upstream = await request(app.getHttpServer()).get("/sample/upstream");
  assert.equal(upstream.status, 502);
  assert.equal(upstream.body.error.code, "UPSTREAM_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(upstream.body), /raw upstream error|html/);
  const zod = await request(app.getHttpServer()).get("/sample/zod-error");
  assert.equal(zod.status, 400);
  assert.equal(zod.body.error.code, "VALIDATION_FAILED");
  assert.deepEqual(zod.body.error.details, [{ field: "/code", issue: "Invalid type" }]);
});

test("newline, oversized, and non-UUID request IDs are replaced", () => {
  assert.equal(acceptedRequestId("abc\nX-Evil: 1"), undefined);
  assert.equal(acceptedRequestId("a".repeat(65)), undefined);
  assert.equal(acceptedRequestId("safe-but-not-uuid"), undefined);
  const middleware = new RequestIdMiddleware(logger);
  const headers = {};
  middleware.use(
    { headers: { "x-request-id": "abc\nX-Evil: 1" } },
    {
      setHeader(name, value) {
        headers[name] = value;
      },
    },
    () => {
      assert.equal(getRequestId(), headers["X-Request-Id"]);
    },
  );
  assert.match(headers["X-Request-Id"], /^[0-9a-f-]{36}$/i);
});

test("errors after headers are sent end the response without writing an envelope", () => {
  let ended = false;
  const response = {
    headersSent: true,
    writableEnded: false,
    end() {
      ended = true;
    },
  };
  const host = {
    switchToHttp() {
      return {
        getResponse() {
          return response;
        },
      };
    },
  };
  new AllExceptionsFilter(logger).catch(new Error("stream failed"), host);
  assert.equal(ended, true);
});

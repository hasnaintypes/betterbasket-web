import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { BootstrapSampleModule } from "./bootstrap.sample.module.mjs";

const require = createRequire(import.meta.url);
const { bootstrapService, getReadinessRegistry } = require("../dist/index.js");

test("health, readiness, CORS, docs gating, and rawBody options", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_DOCS: process.env.ENABLE_DOCS,
    GIT_SHA: process.env.GIT_SHA,
  };
  process.env.NODE_ENV = "production";
  process.env.ENABLE_DOCS = "false";
  process.env.GIT_SHA = "test-sha";
  const app = await bootstrapService({
    module: BootstrapSampleModule,
    name: "sample-service",
    port: 0,
    options: {
      rawBody: true,
      swagger: { title: "Sample", description: "Sample routes", version: "1.0.0" },
    },
  });
  try {
    const server = app.getHttpServer();
    const health = await request(server).get("/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.version, "test-sha");
    assert.equal(health.body.service, "sample-service");
    assert.equal(health.headers["x-request-id"]?.length, 36);
    const ready = await request(server).get("/ready");
    assert.equal(ready.status, 200);
    const preflight = await request(server)
      .options("/health")
      .set("Origin", "https://attacker.example");
    assert.equal(preflight.headers["access-control-allow-origin"], undefined);
    assert.equal((await request(server).get("/docs")).status, 404);
    const raw = await request(server).post("/probe/raw").send({ hello: "world" });
    assert.equal(raw.status, 201);
    assert.equal(raw.body.rawBody, '{"hello":"world"}');

    const registry = getReadinessRegistry(app);
    registry.register("database", () => false);
    const failed = await request(server).get("/ready");
    assert.equal(failed.status, 503);
    assert.equal(failed.body.checks.database, false);
    registry.beginShutdown();
    assert.equal((await request(server).get("/ready")).status, 503);
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("ENABLE_DOCS=true exposes Swagger in production", async () => {
  const beforeNodeEnv = process.env.NODE_ENV;
  const beforeDocs = process.env.ENABLE_DOCS;
  process.env.NODE_ENV = "production";
  process.env.ENABLE_DOCS = "true";
  const app = await bootstrapService({
    module: BootstrapSampleModule,
    name: "docs-sample",
    port: 0,
    options: { swagger: { title: "Sample", description: "Sample routes", version: "1.0.0" } },
  });
  try {
    const response = await request(app.getHttpServer()).get("/docs-json");
    assert.equal(response.status, 200);
    assert.equal(response.body.info.title, "Sample");
  } finally {
    await app.close();
    if (beforeNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = beforeNodeEnv;
    if (beforeDocs === undefined) delete process.env.ENABLE_DOCS;
    else process.env.ENABLE_DOCS = beforeDocs;
  }
});

test(
  "SIGTERM drains an in-flight request and exits within ten seconds",
  { timeout: 15_000 },
  async () => {
    const packageDir = fileURLToPath(new URL("..", import.meta.url));
    const child = spawn(process.execPath, ["test/bootstrap-child.mjs"], {
      cwd: packageDir,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let ready;
    let started;
    const exitPromise = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    const portReady = new Promise((resolve, reject) => {
      ready = resolve;
      child.once("exit", () => reject(new Error("Child exited before startup")));
    });
    const requestStarted = new Promise((resolve, reject) => {
      started = resolve;
      child.once("exit", () => reject(new Error("Child exited before handling request")));
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const port = /READY_PORT=(\d+)/.exec(output)?.[1];
      if (port) ready(Number(port));
      if (output.includes("IN_FLIGHT")) started();
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const port = await portReady;
      const inFlight = request(`http://127.0.0.1:${port}`).get("/probe/slow");
      const responsePromise = inFlight.then((response) => response);
      await requestStarted;
      const before = Date.now();
      child.kill("SIGTERM");
      const response = await responsePromise;
      const exit = await exitPromise;
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { status: "done" });
      assert.ok(exit.code === 0 || exit.signal === "SIGTERM");
      assert.ok(Date.now() - before < 10_000);
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  },
);

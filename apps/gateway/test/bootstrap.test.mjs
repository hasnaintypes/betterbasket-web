import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import testUtils from "@betterbasket/test-utils";
import { Server as SocketServer } from "socket.io";
import { io } from "socket.io-client";

const { createStubUpstream, createJwtTestIssuer } = testUtils;

const serviceDir = fileURLToPath(new URL("..", import.meta.url));

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

test(
  "gateway bootstrap keeps explicit CORS and working proxy routes",
  { timeout: 35_000 },
  async () => {
    const upstream = await createStubUpstream();
    const issuer = await createJwtTestIssuer();
    const analyticsHttp = createServer();
    const analyticsSockets = new SocketServer(analyticsHttp, {
      path: "/socket.io",
      transports: ["websocket"],
    });
    analyticsSockets.of("/realtime").on("connection", (socket) => {
      socket.on("echo", (value, acknowledge) => acknowledge(value));
    });
    analyticsHttp.listen(0, "127.0.0.1");
    await once(analyticsHttp, "listening");
    const analyticsPort = analyticsHttp.address().port;
    const token = await issuer.sign({ sub: "gateway-test-user" });
    upstream.enqueue({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/api/auth/ping" }),
    });
    const port = await unusedPort();
    const unavailablePort = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const env = { ...process.env };
    for (const line of readFileSync(join(serviceDir, ".env.development.example"), "utf8").split(
      /\r?\n/,
    )) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (match) env[match[1]] = match[2];
    }
    Object.assign(env, {
      NODE_ENV: "production",
      PORT: String(port),
      ENABLE_DOCS: "false",
      GIT_SHA: "test-sha",
      AUTH_SERVICE_URL: upstream.url,
      PAYMENT_SERVICE_URL: upstream.url,
      ANALYTICS_SERVICE_URL: `http://127.0.0.1:${analyticsPort}`,
      PRODUCT_SERVICE_URL: `http://127.0.0.1:${unavailablePort}`,
      CORS_ALLOWED_ORIGINS: "https://allowed.example",
    });
    const child = spawn(process.execPath, ["dist/main.js"], {
      cwd: serviceDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let exit;
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("exit", (code, signal) => {
      exit = { code, signal };
    });
    let wsClient;
    try {
      let health;
      for (let attempt = 0; attempt < 200; attempt++) {
        if (exit) throw new Error(`Gateway exited before health was ready: ${output.slice(-1200)}`);
        try {
          health = await fetch(`${base}/health`);
          if (health.ok) break;
        } catch {
          /* wait for startup */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(health?.ok, `Gateway did not become ready: ${output.slice(-1200)}`);
      assert.equal((await health.json()).version, "test-sha");
      assert.equal(health.headers.get("x-content-type-options"), "nosniff");
      const healthWithOrigin = await fetch(`${base}/health`, {
        headers: { Origin: "https://allowed.example" },
      });
      assert.equal(
        healthWithOrigin.headers.get("access-control-allow-origin"),
        "https://allowed.example",
      );
      assert.equal((await fetch(`${base}/ready`)).status, 200);
      assert.equal((await fetch(`${base}/docs`)).status, 404);
      const allowed = await fetch(`${base}/health`, {
        method: "OPTIONS",
        headers: { Origin: "https://allowed.example", "Access-Control-Request-Method": "GET" },
      });
      assert.equal(allowed.headers.get("access-control-allow-origin"), "https://allowed.example");
      const denied = await fetch(`${base}/health`, {
        method: "OPTIONS",
        headers: { Origin: "https://denied.example", "Access-Control-Request-Method": "GET" },
      });
      assert.equal(denied.headers.get("access-control-allow-origin"), null);
      const proxied = await fetch(`${base}/api/auth/ping`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(proxied.status, 200);
      assert.equal(typeof (await proxied.json()).path, "string");
      assert.equal(upstream.requests.length, 1);
      assert.equal(upstream.requests[0].method, "GET");
      assert.equal(upstream.requests[0].headers.authorization, `Bearer ${token}`);
      const webhookBody = ' { "value": "☃" } ';
      const webhook = await fetch(`${base}/webhooks/stripe/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=test" },
        body: webhookBody,
      });
      assert.equal(webhook.status, 200);
      assert.equal(upstream.requests[1].url, "/payments/webhook/account");
      assert.equal(upstream.requests[1].body.toString(), webhookBody);
      const unavailable = await fetch(`${base}/api/products/ping`);
      assert.equal(unavailable.status, 502);
      const unavailableBody = await unavailable.json();
      assert.equal(unavailableBody.error.code, "UPSTREAM_UNAVAILABLE");
      assert.equal(unavailableBody.error.requestId, unavailable.headers.get("x-request-id"));
      assert.equal((await fetch(`${base}/internal/x`)).status, 404);
      assert.equal((await fetch(`${base}/api/auth/jwks`)).status, 404);
      wsClient = io(`${base}/realtime`, {
        path: "/realtime",
        transports: ["websocket"],
        extraHeaders: { Origin: "https://allowed.example" },
        reconnection: false,
        timeout: 3000,
      });
      await new Promise((resolve, reject) => {
        wsClient.once("connect", resolve);
        wsClient.once("connect_error", reject);
      });
      const echoed = await new Promise((resolve) => wsClient.emit("echo", "through-main", resolve));
      assert.equal(echoed, "through-main");
      wsClient.disconnect();
      const before = Date.now();
      child.kill("SIGTERM");
      if (!exit) await once(child, "exit");
      assert.ok(Date.now() - before < 10_000);
      assert.ok(exit.code === 0 || exit.signal === "SIGTERM");
    } finally {
      wsClient?.disconnect();
      if (!exit) child.kill("SIGKILL");
      await upstream.close();
      await issuer.close();
      await new Promise((resolve) => analyticsSockets.close(() => resolve()));
    }
  },
);

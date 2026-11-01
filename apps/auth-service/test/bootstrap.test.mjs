import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

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

test("auth service health, CORS, docs, and SIGTERM", { timeout: 35_000 }, async () => {
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: serviceDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      ENABLE_DOCS: "false",
      GIT_SHA: "test-sha",
      AUTH_SERVICE_URL: base,
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
      BETTER_AUTH_SECRET: "test-only-secret-with-32-characters-minimum",
      TRUSTED_ORIGINS: "http://localhost:3000",
    },
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
  try {
    let health;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (exit)
        throw new Error(`Auth service exited before health was ready: ${output.slice(-1200)}`);
      try {
        health = await fetch(`${base}/health`);
        if (health.ok) break;
      } catch {
        /* wait for startup */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(health?.ok, `Auth service did not become ready: ${output.slice(-1200)}`);
    const body = await health.json();
    assert.equal(body.version, "test-sha");
    assert.equal(body.service, "auth-service");
    const preflight = await fetch(`${base}/health`, {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    });
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
    const authPreflight = await fetch(`${base}/api/auth/get-session`, {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    });
    assert.equal(authPreflight.headers.get("access-control-allow-origin"), null);
    assert.equal((await fetch(`${base}/docs`)).status, 404);
    const before = Date.now();
    child.kill("SIGTERM");
    if (!exit) await once(child, "exit");
    assert.ok(Date.now() - before < 10_000);
    assert.ok(exit.code === 0 || exit.signal === "SIGTERM");
  } finally {
    if (!exit) child.kill("SIGKILL");
  }
});

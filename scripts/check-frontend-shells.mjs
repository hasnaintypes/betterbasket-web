import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function checkApp(app, privateApp) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [`${root}/apps/${app}/node_modules/next/dist/bin/next`, "start", "-p", String(port)],
    {
      cwd: `${root}/apps/${app}`,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`${app} exited: ${output.slice(-1000)}`);
      try {
        response = await fetch(base);
        if (response.ok) break;
      } catch {
        // Wait for startup.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(response?.ok, `${app} did not start: ${output.slice(-1000)}`);
    assert.equal(
      response.headers.get("strict-transport-security"),
      "max-age=63072000; includeSubDomains",
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
    const policy = response.headers.get("content-security-policy-report-only") ?? "";
    assert.equal(response.headers.get("content-security-policy"), null);
    assert.match(policy, /script-src[^;]*'nonce-[^']+'/);
    assert.doesNotMatch(policy.match(/script-src[^;]*/)?.[0] ?? "", /unsafe-inline/);
    assert.match(policy, /connect-src[^;]*http:\/\/localhost:4000[^;]*ws:\/\/localhost:4000/);
    assert.match(policy, privateApp ? /frame-ancestors 'none'/ : /frame-ancestors 'self'/);
    if (privateApp) {
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    }
    const html = await response.text();
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce);
    assert.ok(html.includes(`nonce="${nonce}"`), `${app} HTML scripts lack the CSP nonce`);
    const nextResponse = await fetch(base);
    assert.notEqual(nextResponse.headers.get("content-security-policy-report-only"), policy);
    console.log(`${app}: security headers and per-request nonce passed`);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
  }
}

for (const [app, privateApp] of [
  ["web", false],
  ["seller-portal", true],
  ["admin-portal", true],
]) {
  await checkApp(app, privateApp);
}

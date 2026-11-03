import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const serviceDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(serviceDir, ".env.development") });

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function smoke() {
  const runtimeUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_DATABASE_URL;
  if (!runtimeUrl || !directUrl)
    throw new Error("Development runtime and direct database URLs are required");
  const runtimeRole = decodeURIComponent(new URL(runtimeUrl).username);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole) || runtimeRole === "neondb_owner") {
    throw new Error("Runtime database role is invalid");
  }
  const client = new pg.Client({ connectionString: directUrl, connectionTimeoutMillis: 30_000 });
  let child;
  try {
    await client.connect();
    for (const table of [
      "user",
      "session",
      "account",
      "verification",
      "organization",
      "member",
      "invitation",
      "jwks",
      "audit_log",
      "outbox",
      "processed_events",
    ]) {
      const result = await client.query("SELECT to_regclass($1) AS table_name", [
        `public.${table}`,
      ]);
      assert.ok(result.rows[0]?.table_name, `Migration did not create ${table}`);
    }
    for (const [table, index] of [
      ["user", "user_email_unique"],
      ["session", "session_token_unique"],
      ["member", "member_organization_user_unique"],
    ]) {
      const result = await client.query(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2",
        [table, index],
      );
      assert.match(result.rows[0]?.indexdef ?? "", /CREATE UNIQUE INDEX/);
    }
    await client.query(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}"`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeRole}"`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${runtimeRole}"`);

    const port = await availablePort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["dist/main.js"], {
      cwd: serviceDir,
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: String(port),
        AUTH_SERVICE_URL: base,
        TRUSTED_ORIGINS: base,
        BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
        ENABLE_DOCS: "false",
      },
      stdio: "ignore",
    });
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw new Error("Auth service exited before becoming healthy");
      try {
        const response = await fetch(`${base}/health`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* waiting for startup */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error("Auth service did not become healthy");

    const email = `smoke-${randomUUID()}@example.test`;
    const password = randomBytes(24).toString("base64url");
    const response = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ name: "Migration Smoke", email, password }),
    });
    if (!response.ok) throw new Error(`Sign-up smoke returned HTTP ${response.status}`);
    const user = await client.query('SELECT id FROM "user" WHERE email = $1', [email]);
    assert.equal(user.rowCount, 1, "Sign-up did not persist a user row");
    const account = await client.query('SELECT password FROM "account" WHERE user_id = $1', [
      user.rows[0].id,
    ]);
    assert.equal(account.rowCount, 1, "Sign-up did not persist a credential account");
    assert.notEqual(account.rows[0].password, password, "Password was stored in plaintext");
    process.stdout.write("Auth migration and sign-up smoke passed.\n");
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await client.end().catch(() => {});
  }
}

try {
  await smoke();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const authDir = path.join(rootDir, "apps/auth-service");
const gatewayDir = path.join(rootDir, "apps/gateway");
const requireWeb = createRequire(path.join(webDir, "package.json"));
const requireAuth = createRequire(path.join(authDir, "package.json"));
const { Pool } = requireAuth("pg");
const webOrigin = "http://127.0.0.1:3110";
const gatewayOrigin = "http://127.0.0.1:4110";
const authOrigin = "http://127.0.0.1:4111";
const runtimeEnv = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "PNPM_HOME"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);

function build(service) {
  const result = spawnSync("pnpm", ["--filter", service, "build"], {
    cwd: rootDir,
    env: runtimeEnv,
    encoding: "utf8",
    timeout: 90_000,
  });
  assert.equal(result.status, 0, `${service} build failed`);
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.equal(child.exitCode, null, `Local server exited before ${url} was ready`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Local server did not become ready: ${url}`);
}

function start(cwd, command, args, env) {
  return spawn(command, args, { cwd, env, stdio: "ignore" });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function verificationToken(email, secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ email, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

async function assertAccessible(page) {
  await page.addScriptTag({ path: requireWeb.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document);
    return result.violations
      .filter((violation) => ["serious", "critical"].includes(violation.impact))
      .map((violation) => violation.id);
  });
  assert.deepEqual(violations, []);
}

test(
  "buyer signs up, verifies, signs in, and signs out through the local stack",
  { timeout: 180_000 },
  async () => {
    assert.ok(
      process.env.AUTH_E2E_ADMIN_DATABASE_URL,
      "Set AUTH_E2E_ADMIN_DATABASE_URL to a nonproduction PostgreSQL connection that can create and drop databases",
    );
    const adminUrl = new URL(process.env.AUTH_E2E_ADMIN_DATABASE_URL);
    assert.ok(["postgres:", "postgresql:"].includes(adminUrl.protocol));
    assert.ok(
      adminUrl.hostname && adminUrl.username && adminUrl.password && adminUrl.pathname.length > 1,
    );
    const adminDatabase = decodeURIComponent(adminUrl.pathname.slice(1));
    const adminRole = decodeURIComponent(adminUrl.username);
    const dbName = `bb_auth_e2e_${randomUUID().replaceAll("-", "")}`;
    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${dbName}`;
    const admin = new Pool({ connectionString: adminUrl.toString() });
    const secret = randomBytes(32).toString("hex");
    const common = { ...runtimeEnv, GIT_SHA: "auth-e2e", ENABLE_DOCS: "false" };
    const authEnv = {
      ...common,
      NODE_ENV: "test",
      PORT: "4111",
      BASE_URL: gatewayOrigin,
      TRUSTED_ORIGINS: `${gatewayOrigin},${webOrigin}`,
      WEB_URL: webOrigin,
      DATABASE_URL: testUrl.toString(),
      DIRECT_DATABASE_URL: testUrl.toString(),
      BETTER_AUTH_SECRET: secret,
      AUDIT_IP_SALT: randomBytes(32).toString("hex"),
      EMAIL_FROM: "BetterBasket <no-reply@example.test>",
      EMAIL_ALLOWED_RECIPIENTS: "test@example.test",
    };
    const gatewayEnv = {
      ...common,
      NODE_ENV: "test",
      PORT: "4110",
      CORS_ALLOWED_ORIGINS: webOrigin,
      TRUSTED_PROXY_HOPS: "0",
      AUTH_SERVICE_URL: authOrigin,
      PRODUCT_SERVICE_URL: "http://127.0.0.1:4999",
      SELLER_SERVICE_URL: "http://127.0.0.1:4999",
      ORDER_SERVICE_URL: "http://127.0.0.1:4999",
      PAYMENT_SERVICE_URL: "http://127.0.0.1:4999",
      MEDIA_SERVICE_URL: "http://127.0.0.1:4999",
      ANALYTICS_SERVICE_URL: "http://127.0.0.1:4999",
    };
    let created = false;
    let auth;
    let gateway;
    let web;
    let browser;
    try {
      const target = await admin.query(
        "SELECT current_database() AS database, current_user AS role, inet_server_port() AS port",
      );
      assert.equal(target.rows[0].database, adminDatabase);
      assert.equal(target.rows[0].role, adminRole);
      build("auth-service");
      build("gateway");
      await admin.query(`CREATE DATABASE "${dbName}"`);
      created = true;
      const migration = spawnSync("pnpm", ["db:migrate"], {
        cwd: authDir,
        env: authEnv,
        encoding: "utf8",
        timeout: 60_000,
      });
      assert.equal(migration.status, 0, "Disposable auth database migration failed");
      auth = start(authDir, process.execPath, ["dist/main.js"], authEnv);
      await waitFor(`${authOrigin}/health`, auth);
      gateway = start(gatewayDir, process.execPath, ["dist/main.js"], gatewayEnv);
      await waitFor(`${gatewayOrigin}/health`, gateway);
      web = start(
        webDir,
        process.execPath,
        [requireWeb.resolve("next/dist/bin/next"), "dev", "-p", "3110"],
        {
          ...runtimeEnv,
          NODE_ENV: "development",
          NEXT_PUBLIC_API_URL: gatewayOrigin,
        },
      );
      await waitFor(`${webOrigin}/sign-up`, web);
      browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome",
        headless: true,
        args: ["--no-sandbox"],
      });
      const page = await browser.newPage();
      const email = `buyer-${randomUUID()}@example.test`;
      const password = "valid-password-12345";
      await page.goto(`${webOrigin}/sign-up`);
      await assertAccessible(page);
      await page.getByLabel("Name").fill("Browser Buyer");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByLabel("Confirm password").fill(password);
      await page.getByRole("button", { name: "Create account" }).click();
      await page
        .getByRole("status")
        .getByText("Check your email for a verification link.", { exact: false })
        .waitFor();

      const token = verificationToken(email, secret);
      const verificationUrl = new URL(`${gatewayOrigin}/api/auth/verify-email`);
      verificationUrl.searchParams.set("token", token);
      verificationUrl.searchParams.set("callbackURL", `${webOrigin}/email-verified`);
      await page.goto(verificationUrl.toString());
      await page.waitForURL(`${webOrigin}/email-verified`);
      await assertAccessible(page);
      await page.getByRole("link", { name: "Go to your account" }).click();
      await page.getByText(email).waitFor();
      await assertAccessible(page);
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(webOrigin + "/");

      await page.goto(`${webOrigin}/sign-in`);
      await assertAccessible(page);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(webOrigin + "/");
      await page.goto(`${webOrigin}/account`);
      await page.getByText(email).waitFor();
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(webOrigin + "/");
      console.log("Local browser journey and auth-route accessibility checks passed");
    } finally {
      await browser?.close();
      await stop(web);
      await stop(gateway);
      await stop(auth);
      if (created) await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  },
);

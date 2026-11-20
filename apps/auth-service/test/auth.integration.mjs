import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import pg from "pg";

const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;
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
  "auth HTTP integration: claims, cookies, rate limit, and key rotation",
  { timeout: 90_000 },
  async () => {
    assert.ok(
      databaseUrl,
      "Set AUTH_INTEGRATION_DATABASE_URL to a migrated disposable PostgreSQL database",
    );
    const db = new pg.Pool({ connectionString: databaseUrl, keepAlive: true, max: 2 });
    // A disposable database can be reused across local runs. Keys from an older
    // test secret cannot be decrypted by this run's new secret.
    await db.query('DELETE FROM "jwks"');
    await db.query('DELETE FROM "rate_limit"');
    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ["dist/main.js"], {
      cwd: serviceDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        ENABLE_DOCS: "false",
        GIT_SHA: "integration",
        BASE_URL: base,
        TRUSTED_ORIGINS: base,
        WEB_URL: base,
        EMAIL_FROM: "BetterBasket <no-reply@example.test>",
        EMAIL_ALLOWED_RECIPIENTS: "test@example.test",
        BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
        DATABASE_URL: databaseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (data) => {
        output += data.toString();
      });
    }
    try {
      let ready = false;
      for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`Service exited: ${output.slice(-1500)}`);
        try {
          ready = (await fetch(`${base}/health`)).ok;
          if (ready) break;
        } catch {
          /* startup */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, `Service did not start: ${output.slice(-1500)}`);

      const email = `integration-${randomUUID()}@example.test`;
      const signup = await fetch(`${base}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ name: "Integration User", email, password: "valid-password-12345" }),
      });
      assert.equal(signup.status, 200, `Sign-up returned ${signup.status}`);
      const signupBody = await signup.json();
      assert.equal(signupBody.token, null, "Unverified sign-up must not create a session token");
      const duplicateSignup = await fetch(`${base}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ name: "Integration User", email, password: "valid-password-12345" }),
      });
      assert.equal(duplicateSignup.status, signup.status);
      assert.equal((await duplicateSignup.json()).token, null);
      const user = (await db.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0];
      const unverifiedSignIn = await fetch(`${base}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ email, password: "valid-password-12345" }),
      });
      assert.equal(unverifiedSignIn.status, 403);
      await db.query('UPDATE "user" SET email_verified = true WHERE id = $1', [user.id]);
      const signin = await fetch(`${base}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ email, password: "valid-password-12345" }),
      });
      assert.equal(signin.status, 200, `Sign-in returned ${signin.status}`);
      const cookies = signin.headers.getSetCookie();
      const sessionCookie = cookies.find((value) => value.includes("session_token="));
      assert.ok(sessionCookie, `No session cookie: ${cookies}`);
      assert.match(sessionCookie, /; Secure/i);
      assert.match(sessionCookie, /; HttpOnly/i);
      assert.match(sessionCookie, /; SameSite=Lax/i);
      assert.doesNotMatch(sessionCookie, /; Domain=/i);
      const cookie = sessionCookie.split(";")[0];

      const getToken = async () => {
        const response = await fetch(`${base}/api/auth/token`, { headers: { cookie } });
        assert.equal(response.status, 200, `Token returned ${response.status}`);
        return (await response.json()).token;
      };
      const getKeys = async () => {
        const response = await fetch(`${base}/api/auth/jwks`);
        assert.equal(response.status, 200);
        return response.json();
      };
      const verify = async (token) =>
        jwtVerify(token, createLocalJWKSet(await getKeys()), {
          issuer: base,
          audience: base,
          algorithms: ["EdDSA"],
        });

      const noOrgToken = await getToken();
      const noOrg = (await verify(noOrgToken)).payload;
      const expectedKeys = [
        "aud",
        "email",
        "emailVerified",
        "exp",
        "iat",
        "iss",
        "jti",
        "orgId",
        "orgRole",
        "platformRole",
        "sub",
      ];
      assert.deepEqual(Object.keys(noOrg).sort(), expectedKeys);
      assert.equal(noOrg.sub, user.id);
      assert.equal(noOrg.email, email);
      assert.equal(noOrg.emailVerified, true);
      assert.equal(noOrg.platformRole, "customer");
      assert.equal(noOrg.orgId, null);
      assert.equal(noOrg.orgRole, null);
      assert.equal(noOrg.exp - noOrg.iat, 15 * 60);
      assert.ok(noOrg.jti);

      const orgId = randomUUID();
      await db.query(
        'INSERT INTO "organization" (id, name, slug, created_at) VALUES ($1, $2, $3, now())',
        [orgId, "Integration Org", orgId],
      );
      await db.query(
        'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now())',
        [randomUUID(), orgId, user.id, "owner"],
      );
      await db.query('UPDATE "session" SET active_organization_id = $1 WHERE user_id = $2', [
        orgId,
        user.id,
      ]);
      const memberClaims = (await verify(await getToken())).payload;
      assert.deepEqual(Object.keys(memberClaims).sort(), expectedKeys);
      assert.equal(memberClaims.orgId, orgId);
      assert.equal(memberClaims.orgRole, "owner");
      await db.query('DELETE FROM "member" WHERE organization_id = $1 AND user_id = $2', [
        orgId,
        user.id,
      ]);
      const removedClaims = (await verify(await getToken())).payload;
      assert.equal(removedClaims.orgId, null);
      assert.equal(removedClaims.orgRole, null);

      const resetRequest = async (requestedEmail) => {
        const start = performance.now();
        const response = await fetch(`${base}/api/auth/request-password-reset`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify({ email: requestedEmail }),
        });
        return {
          status: response.status,
          body: await response.json(),
          elapsed: performance.now() - start,
        };
      };
      const knownReset = await resetRequest(email);
      const unknownReset = await resetRequest(`missing-${randomUUID()}@example.test`);
      assert.equal(knownReset.status, unknownReset.status);
      assert.deepEqual(knownReset.body, unknownReset.body);
      assert.ok(knownReset.elapsed < 5_000, `Known-email reset took ${knownReset.elapsed}ms`);
      assert.ok(unknownReset.elapsed < 5_000, `Unknown-email reset took ${unknownReset.elapsed}ms`);
      await resetRequest(email);
      const fourthReset = await resetRequest(email);
      assert.equal(fourthReset.status, 429);

      const oldKid = decodeProtectedHeader(noOrgToken).kid;
      await db.query("UPDATE \"jwks\" SET expires_at = now() - interval '1 minute' WHERE id = $1", [
        oldKid,
      ]);
      const newToken = await getToken();
      assert.notEqual(decodeProtectedHeader(newToken).kid, oldKid);
      assert.equal((await verify(noOrgToken)).payload.sub, user.id);
      assert.equal((await verify(newToken)).payload.sub, user.id);
      await db.query(
        "UPDATE \"jwks\" SET expires_at = now() - interval '61 minutes' WHERE id = $1",
        [oldKid],
      );
      await assert.rejects(verify(noOrgToken));
      assert.equal((await verify(newToken)).payload.sub, user.id);

      const statuses = [];
      for (let i = 0; i < 6; i++) {
        const response = await fetch(`${base}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify({ email, password: "invalid-password-12345" }),
        });
        statuses.push(response.status);
      }
      assert.equal(statuses.at(-1), 429, `Sign-in statuses: ${statuses}`);
    } finally {
      child.kill("SIGTERM");
      if (child.exitCode === null)
        await Promise.race([
          once(child, "exit"),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      if (child.exitCode === null) child.kill("SIGKILL");
      await db.end();
    }
  },
);

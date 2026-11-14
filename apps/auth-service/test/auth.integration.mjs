import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, SignJWT } from "jose";
import pg from "pg";
import bootstrapModule from "../dist/admin/bootstrap-admin.js";

const { bootstrapAdmin } = bootstrapModule;

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
    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    // A disposable database can be reused across local runs. Keys from an older
    // test secret cannot be decrypted by this run's new secret.
    await db.query('DELETE FROM "jwks"');
    await db.query('DELETE FROM "rate_limit"');
    const auditSalt = randomBytes(32).toString("hex");
    const authSecret = randomBytes(32).toString("hex");
    const bootstrapIds = [];
    let promotedUserId;
    let ownerMembershipId;
    let auditOrganizationId;
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
        BETTER_AUTH_SECRET: authSecret,
        AUDIT_IP_SALT: auditSalt,
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
      const cookies = signup.headers.getSetCookie();
      const sessionCookie = cookies.find((value) => value.includes("session_token="));
      assert.ok(sessionCookie, `No session cookie: ${cookies}`);
      assert.match(sessionCookie, /; Secure/i);
      assert.match(sessionCookie, /; HttpOnly/i);
      assert.match(sessionCookie, /; SameSite=Lax/i);
      assert.doesNotMatch(sessionCookie, /; Domain=/i);
      const cookie = sessionCookie.split(";")[0];
      const user = (await db.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0];

      const failedRequestId = randomUUID();
      const successRequestId = randomUUID();
      for (const [requestId, password, expectedStatus] of [
        [failedRequestId, "wrong-password-12345", 401],
        [successRequestId, "valid-password-12345", 200],
      ]) {
        const response = await fetch(`${base}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: base,
            "x-request-id": requestId,
            "x-forwarded-for": "203.0.113.7",
          },
          body: JSON.stringify({ email, password }),
        });
        assert.equal(response.status, expectedStatus);
      }
      const auditRows = (
        await db.query(
          "SELECT action, actor_id, ip_hash, details FROM audit_log WHERE request_id = ANY($1::uuid[]) ORDER BY at",
          [[failedRequestId, successRequestId]],
        )
      ).rows;
      assert.deepEqual(auditRows.map((row) => row.action).sort(), [
        "sign_in.failed",
        "sign_in.succeeded",
      ]);
      assert.equal(auditRows.find((row) => row.action === "sign_in.failed")?.actor_id, null);
      assert.ok(auditRows.some((row) => row.actor_id === user.id));
      for (const row of auditRows) {
        assert.equal(
          row.ip_hash,
          createHmac("sha256", auditSalt).update("203.0.113.7").digest("hex"),
        );
        assert.deepEqual(row.details, { method: "email" });
      }

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
      assert.equal(noOrg.emailVerified, false);
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
      const keyAudit = await db.query(
        "SELECT action, details FROM audit_log WHERE action = ANY($1::text[]) AND target_id = ANY($2::text[])",
        [
          ["jwks.key_created", "jwks.key_rotated"],
          [oldKid, decodeProtectedHeader(newToken).kid],
        ],
      );
      assert.equal(keyAudit.rows.length, 2);
      assert.deepEqual(keyAudit.rows.map((row) => row.action).sort(), [
        "jwks.key_created",
        "jwks.key_rotated",
      ]);
      assert.ok(keyAudit.rows.every((row) => Object.keys(row.details).length === 0));

      const verifyToken = await new SignJWT({ email })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(authSecret));
      const verified = await fetch(
        `${base}/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}&callbackURL=${encodeURIComponent(base)}`,
        { redirect: "manual", headers: { "x-forwarded-for": "203.0.113.7" } },
      );
      assert.equal(verified.status, 302);
      assert.equal(
        (await db.query('SELECT email_verified FROM "user" WHERE id = $1', [user.id])).rows[0]
          .email_verified,
        true,
      );

      const changed = await fetch(`${base}/api/auth/change-password`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base, cookie },
        body: JSON.stringify({
          currentPassword: "valid-password-12345",
          newPassword: "changed-password-12345",
        }),
      });
      assert.equal(changed.status, 200);
      const resetToken = randomUUID();
      await db.query(
        "INSERT INTO \"verification\" (id, identifier, value, expires_at, created_at, updated_at) VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())",
        [randomUUID(), `reset-password:${resetToken}`, user.id],
      );
      const reset = await fetch(`${base}/api/auth/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ token: resetToken, newPassword: "reset-password-12345" }),
      });
      assert.equal(reset.status, 200);
      const pool = new pg.Pool({ connectionString: databaseUrl });
      try {
        const secondId = randomUUID();
        bootstrapIds.push(secondId);
        await db.query(
          'INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES ($1, $2, $3, false, $4, now(), now())',
          [secondId, "Bootstrap Test", `${secondId}@example.test`, "customer"],
        );
        await assert.rejects(
          bootstrapAdmin(pool, `${secondId}@example.test`, false),
          /verified email/,
        );
        const cliEnv = {
          ...process.env,
          NODE_ENV: "test",
          PORT: String(port),
          ENABLE_DOCS: "false",
          GIT_SHA: "integration",
          BASE_URL: base,
          TRUSTED_ORIGINS: base,
          BETTER_AUTH_SECRET: authSecret,
          AUDIT_IP_SALT: auditSalt,
          DATABASE_URL: databaseUrl,
          ADMIN_BOOTSTRAP_EMAIL: email,
        };
        const runAdminCli = (args = [], bootstrapEmail = email) =>
          spawnSync(
            process.execPath,
            ["-r", "ts-node/register", "scripts/create-admin.ts", ...args],
            {
              cwd: serviceDir,
              env: { ...cliEnv, ADMIN_BOOTSTRAP_EMAIL: bootstrapEmail },
              encoding: "utf8",
              timeout: 20_000,
            },
          );
        const first = runAdminCli();
        assert.equal(first.status, 0, first.stderr);
        promotedUserId = user.id;
        const second = runAdminCli();
        assert.notEqual(second.status, 0);
        assert.match(second.stderr, /admin already exists/);
        await db.query('UPDATE "user" SET email_verified = true WHERE id = $1', [secondId]);
        const additional = runAdminCli(["--allow-additional"], `${secondId}@example.test`);
        assert.equal(additional.status, 0, additional.stderr);
        const admins = (
          await db.query('SELECT id FROM "user" WHERE id = ANY($1::text[]) AND role = $2', [
            [user.id, secondId],
            "admin",
          ])
        ).rows;
        assert.equal(admins.length, 2);

        const adminSignIn = await fetch(`${base}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify({ email, password: "reset-password-12345" }),
        });
        assert.equal(adminSignIn.status, 200);
        const adminCookie = adminSignIn.headers
          .getSetCookie()
          .find((value) => value.includes("session_token="))
          ?.split(";")[0];
        assert.ok(adminCookie);
        const adminPost = (path, body) =>
          fetch(`${base}/api/auth${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: base, cookie: adminCookie },
            body: JSON.stringify(body),
          });
        assert.equal(
          (await adminPost("/admin/set-role", { userId: secondId, role: "admin" })).status,
          200,
        );
        assert.equal(
          (
            await adminPost("/admin/ban-user", {
              userId: secondId,
              banReason: 'malicious\n{"token":"do-not-store"}',
            })
          ).status,
          200,
        );
        assert.equal((await adminPost("/admin/unban-user", { userId: secondId })).status, 200);
        const adminRows = (
          await db.query(
            "SELECT action, details FROM audit_log WHERE target_id = $1 AND action = ANY($2::text[])",
            [secondId, ["user.banned", "user.unbanned", "user.role_changed"]],
          )
        ).rows;
        assert.deepEqual(
          adminRows.map((row) => row.action).sort(),
          ["user.banned", "user.role_changed", "user.unbanned", "user.role_changed"].sort(),
        );
        assert.ok(adminRows.every((row) => !JSON.stringify(row.details).includes("do-not-store")));

        const createdOrganization = await adminPost("/organization/create", {
          name: "Audit Membership Test",
          slug: randomUUID(),
          keepCurrentActiveOrganization: true,
        });
        assert.equal(createdOrganization.status, 200);
        auditOrganizationId = (await createdOrganization.json()).id;
        const addedRows = await db.query(
          "SELECT action FROM audit_log WHERE action = $1 AND target_id = $2",
          ["organization.member_added", auditOrganizationId],
        );
        assert.equal(addedRows.rows.length, 1);

        ownerMembershipId = randomUUID();
        const targetMembershipId = randomUUID();
        await db.query(
          'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now()), ($5, $2, $6, $7, now())',
          [ownerMembershipId, orgId, user.id, "owner", targetMembershipId, secondId, "member"],
        );
        assert.equal(
          (
            await adminPost("/organization/update-member-role", {
              memberId: targetMembershipId,
              organizationId: orgId,
              role: "admin",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await adminPost("/organization/remove-member", {
              memberIdOrEmail: targetMembershipId,
              organizationId: orgId,
            })
          ).status,
          200,
        );
        const membershipRows = (
          await db.query(
            "SELECT action FROM audit_log WHERE target_id = $1 AND action = ANY($2::text[])",
            [orgId, ["organization.member_role_changed", "organization.member_removed"]],
          )
        ).rows;
        assert.deepEqual(membershipRows.map((row) => row.action).sort(), [
          "organization.member_removed",
          "organization.member_role_changed",
        ]);

        const signOut = await adminPost("/sign-out", {});
        assert.equal(signOut.status, 200);
      } finally {
        await pool.end();
      }
      const actionRows = (
        await db.query(
          "SELECT action FROM audit_log WHERE target_id = $1 AND action = ANY($2::text[])",
          [user.id, ["email.verified", "password.changed", "password.reset", "sign_out.succeeded"]],
        )
      ).rows;
      assert.deepEqual(actionRows.map((row) => row.action).sort(), [
        "email.verified",
        "password.changed",
        "password.reset",
        "sign_out.succeeded",
      ]);
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
      if (ownerMembershipId) {
        await db.query('DELETE FROM "member" WHERE id = $1', [ownerMembershipId]);
      }
      if (auditOrganizationId) {
        await db.query('DELETE FROM "member" WHERE organization_id = $1', [auditOrganizationId]);
        await db.query('DELETE FROM "organization" WHERE id = $1', [auditOrganizationId]);
      }
      if (bootstrapIds.length) {
        await db.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [bootstrapIds]);
      }
      if (promotedUserId) {
        await db.query('UPDATE "user" SET role = $1 WHERE id = $2', ["customer", promotedUserId]);
      }
      await db.end();
    }
  },
);

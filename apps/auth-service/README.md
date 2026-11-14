# Auth service

## Runtime security configuration

The service requires `BASE_URL` (the public API origin), `TRUSTED_ORIGINS` (an
explicit comma-separated list of frontend origins), `BETTER_AUTH_SECRET` (at
least 32 UTF-8 bytes), `AUDIT_IP_SALT` (an independent 32-byte secret), and
`DATABASE_URL` (the runtime PostgreSQL URL). It
fails startup when any are missing or invalid. `DIRECT_DATABASE_URL` is used
only by Drizzle migrations. See the environment examples for each deployment.

Better Auth issues 15-minute EdDSA JWTs with `iss` and `aud` equal to
`BASE_URL`. The token includes only the v2 claims. `orgId` and `orgRole` are
null unless the user's active organization has a current membership row. An
organization claim alone never grants seller access. JWKS keys rotate every
30 days; expired keys remain published for one hour. Keep the JWKS endpoint
private to service callers at the gateway.

Session cookies are Secure, HttpOnly, SameSite=Lax, and host-only on the API
host. Frontends must call the gateway with credentials included. Database
rate limiting permits five email sign-in attempts per minute per limiter key;
the sixth returns 429. Passwords require at least 12 characters.

The local HTTP integration test requires a migrated disposable PostgreSQL
database. Set `AUTH_INTEGRATION_DATABASE_URL` and run
`pnpm --filter auth-service test:integration`. It exercises JWT verification
against the service JWKS, membership changes, cookie attributes, rate limits,
and key rotation.

## Auth database and migrations

The auth service uses the `bb_auth` database on a developer's approved Neon
development branch. Runtime traffic uses the pooled `DATABASE_URL` and a SQL
created role without DDL rights. Drizzle uses `DIRECT_DATABASE_URL` and the
separate migrator role. The [root README](../../README.md#local-development--no-docker-required)
describes the guarded branch setup.

## Schema ownership

- `src/db/schema.auth.ts` comes from the pinned Better Auth CLI and the
  deterministic `scripts/generate-auth-schema.mjs` transform. The transform
  gives generated timestamps a time zone and adds the unique
  `(organization_id, user_id)` membership index.
- `src/db/schema.app.ts` holds `audit_log`, `outbox`, and `processed_events`.
  These tables use UUID event/row IDs and UTC timestamps. `audit_log` stores
  `ip_hash` rather than a raw IP address. The audit writer HMACs IPs with
  `AUDIT_IP_SALT`, stores only controlled detail flags, and never copies
  passwords, tokens, full emails, ban reasons, or user agents into details.
- `src/db/schema.ts` re-exports both files. Better Auth's generated identity
  IDs remain text columns; the application-owned row and event IDs use UUID.

## Change and apply the schema

Run these commands after `pnpm install` and review the SQL before applying it:

```bash
# Only when Better Auth options or plugins change:
pnpm --filter auth-service auth:generate-schema

# When any auth or application table changes:
pnpm --filter auth-service db:generate
pnpm --filter auth-service auth:check-schema
pnpm --filter auth-service db:check
pnpm --filter auth-service db:migrate
```

Commit the generated SQL and Drizzle snapshot under `drizzle/` together with
the schema change. `auth:check-schema` regenerates into a temporary file and
fails if the committed Better Auth schema differs. `db:check` checks the
committed Drizzle snapshots. `db:migrate` is safe to rerun; Drizzle records
applied migrations. Keep changes additive until the previous application
version has been retired.

After migration, grant the runtime role DML access from the migrator's **direct**
connection, replacing the role name if needed:

```sql
GRANT USAGE ON SCHEMA public TO bb_auth_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bb_auth_app;
REVOKE ALL ON TABLE audit_log FROM bb_auth_app;
GRANT SELECT, INSERT ON TABLE audit_log TO bb_auth_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bb_auth_app;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bb_auth_app;
```

Do not grant schema `CREATE`, database `CREATE`, `CREATEROLE`, or
`neon_superuser` membership to the runtime role. The migrator URL must not be
used by the running auth service.

The audit permission migration also revokes public table access and limits
`bb_auth_app` to `SELECT` and `INSERT` on `audit_log`. If a deployment uses a
different runtime role name, apply the equivalent role-specific grants before
starting auth-service. Verify that `has_table_privilege` is false for `UPDATE`
and `DELETE` on this table. Audit timestamps come from PostgreSQL `now()`.

## Audit events and admin bootstrap

Auth hooks append sign-in success/failure, sign-out, password change/reset,
email verification, ban/unban, platform role changes, organization membership
changes, and JWKS key creation/rotation to `audit_log`. A failed audit insert
does not reject an auth request; it emits a structured `audit write failed`
error with an `auditWriteFailuresTotal` counter. The writer never stores raw
IP addresses. It does not store user agents, so even oversized or malicious
ones cannot enter the audit table.

To grant the first admin role, create a normal account and verify its email
through the configured auth flow. Put that account's address in
`ADMIN_BOOTSTRAP_EMAIL` in a local ignored environment setting, then run:

```bash
pnpm --filter auth-service auth:create-admin
```

The command uses the runtime database connection, locks concurrent bootstrap
runs, requires a verified account, and writes an audit row in the same
transaction. It never exposes an admin creation endpoint over HTTP. It
refuses when any admin already exists; to promote a second verified account
after an explicit operator decision, pass `--allow-additional`. The command
does not print the account address or database connection details.

## Neon migration smoke

`.github/workflows/migrations.yml` can be run manually once GitHub Actions is
available and configured. It creates an expiring branch in the approved Free
development project, migrates twice, checks the schema, signs up a synthetic
user, verifies its row and password hash, and deletes the branch. It needs the
repository secret `NEON_API_KEY` and variable `NEON_DEV_PROJECT_ID`. The project
must be separate from staging and production, contain only synthetic data, and
have `dev` or `development` in its name. The job never prints connection strings.

The same checks can be run locally through an authenticated Neon CLI session
using an approved development project. Local CLI login does not require a
GitHub repository secret.

# Auth service

## Runtime security configuration

The service requires `BASE_URL` (the public API origin), `TRUSTED_ORIGINS` (an
explicit comma-separated list of frontend origins), `BETTER_AUTH_SECRET` (at
least 32 UTF-8 bytes), and `DATABASE_URL` (the runtime PostgreSQL URL). It
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

## Verification and password reset email

New accounts must verify their email before password sign-in. Verification and
password reset links expire after one hour. Better Auth sends through a small
`EmailSender` interface: local development uses a console sender that logs
only that delivery was suppressed; setting `RESEND_API_KEY` selects Resend.
Resend delivery requires a verified sender in `EMAIL_FROM`.

Set `WEB_URL` to one of `TRUSTED_ORIGINS`. Email callbacks are built from that
configured frontend URL; request headers and callback URLs supplied by callers
do not choose the destination. In non-production, `EMAIL_ALLOWED_RECIPIENTS`
must list each address permitted to receive mail. Other recipients are silently
suppressed. Production requires `RESEND_API_KEY`. Both verification resend and
password reset requests are limited to three per minute per Better Auth rate
limit key. Resend 429 responses receive at most two bounded background retries;
mail delivery never blocks sign-up or reset requests.

Do not put API keys in tracked env examples. Add `RESEND_API_KEY`,
`EMAIL_FROM`, `EMAIL_ALLOWED_RECIPIENTS`, and `WEB_URL` to the deployment's
secret/environment settings. CI remains separately managed.

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
  `ip_hash` rather than a raw IP address; callers must compute a salted hash
  and keep secrets out of `details`.
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
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bb_auth_app;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bb_auth_app;
```

Do not grant schema `CREATE`, database `CREATE`, `CREATEROLE`, or
`neon_superuser` membership to the runtime role. The migrator URL must not be
used by the running auth service.

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

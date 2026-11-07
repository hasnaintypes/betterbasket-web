# Auth database and migrations

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

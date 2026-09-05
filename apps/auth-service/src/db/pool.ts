import { Pool } from "pg";

/**
 * Single Postgres pool for auth-service. Better Auth's Drizzle adapter and the
 * generated schema (see `schema.ts`) both read/write through this pool.
 */
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/betterbasket_auth",
});

import { Pool } from "pg";
import { getAuthConfig } from "../config";

/**
 * Single Postgres pool for auth-service. Better Auth's Drizzle adapter and the
 * generated schema (see `schema.ts`) both read/write through this pool.
 */
export const pool = new Pool({
  connectionString: getAuthConfig().DATABASE_URL,
});

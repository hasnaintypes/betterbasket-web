import type { Pool } from "pg";

export class AdminBootstrapError extends Error {}

/** Promote an existing verified user from a private CLI, never an HTTP route. */
export async function bootstrapAdmin(
  pool: Pool,
  email: string,
  allowAdditional: boolean,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize concurrent invocations, including the first run with no admin
    // row to lock. This lock is scoped to the transaction.
    await client.query("SELECT pg_advisory_xact_lock(2307, 1)");
    const admins = await client.query<{ id: string }>(
      'SELECT id FROM "user" WHERE role = $1 LIMIT 1',
      ["admin"],
    );
    if (admins.rowCount && !allowAdditional) {
      throw new AdminBootstrapError(
        "An admin already exists; pass --allow-additional to promote another",
      );
    }
    const users = await client.query<{ id: string; email_verified: boolean; role: string | null }>(
      'SELECT id, email_verified, role FROM "user" WHERE lower(email) = lower($1) FOR UPDATE',
      [email],
    );
    const user = users.rows[0];
    if (!user) throw new AdminBootstrapError("Target account does not exist");
    if (!user.email_verified)
      throw new AdminBootstrapError("Target account must have a verified email");
    if (user.role === "admin") throw new AdminBootstrapError("Target account is already an admin");
    await client.query('UPDATE "user" SET role = $1, updated_at = now() WHERE id = $2', [
      "admin",
      user.id,
    ]);
    await client.query(
      "INSERT INTO audit_log (actor_type, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)",
      ["system", "user.role_changed", "user", user.id, JSON.stringify({ allowAdditional })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function validateBootstrapEmail(value: string | undefined): string {
  if (!value || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new AdminBootstrapError("Set ADMIN_BOOTSTRAP_EMAIL to an existing verified account");
  }
  return value;
}

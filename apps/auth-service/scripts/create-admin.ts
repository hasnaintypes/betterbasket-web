import { Pool } from "pg";
import {
  AdminBootstrapError,
  bootstrapAdmin,
  validateBootstrapEmail,
} from "../src/admin/bootstrap-admin";
import { getAuthConfig } from "../src/config";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--allow-additional")) {
    throw new AdminBootstrapError("Only --allow-additional is supported");
  }
  const config = getAuthConfig();
  const email = validateBootstrapEmail(process.env.ADMIN_BOOTSTRAP_EMAIL);
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  try {
    await bootstrapAdmin(pool, email, args.includes("--allow-additional"));
    process.stdout.write("Admin role granted to the verified account.\n");
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof AdminBootstrapError ? error.message : "Admin bootstrap failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

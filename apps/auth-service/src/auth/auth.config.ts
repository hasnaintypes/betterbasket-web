import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "../db/pool";
import * as schema from "../db/schema";

const db = drizzle(pool, { schema });

/**
 * `better-auth` ships pure ESM (no CJS build) while this service compiles to
 * CommonJS (matches the other 8 NestJS services). Node.js CommonJS files can
 * still load an ESM-only package via *dynamic* `import()` (just not a static
 * `import`/`require`) — so this is an async factory instead of a plain
 * exported constant. Called once from `main.ts` before `NestFactory.create`.
 *
 * Roles:
 * - Platform role ("customer" | "admin") comes from the `admin` plugin.
 * - "Seller" is not a platform role — it's derived from organization
 *   membership (a user who owns/administers a `organization` = a seller
 *   store, see seller-service). We fold that into the JWT payload below so
 *   downstream services get it for free.
 */
export async function createAuth() {
  const { betterAuth } = await import("better-auth");
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  const { organization, admin, jwt } = await import("better-auth/plugins");

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    baseURL: process.env.AUTH_SERVICE_URL ?? "http://localhost:4001",
    trustedOrigins: (
      process.env.TRUSTED_ORIGINS ??
      "http://localhost:3000,http://localhost:3001,http://localhost:3002"
    )
      .split(",")
      .filter(Boolean),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
      organization({
        // Any signed-in user can spin up a store; seller-service listens on
        // `afterCreateOrganization` (via Kafka, see contracts' SellerOnboarded
        // event) to create the matching Seller row.
        allowUserToCreateOrganization: true,
      }),
      admin({
        defaultRole: "customer",
        adminRoles: ["admin"],
      }),
      jwt({
        jwt: {
          // Keep the JWT lean — only what downstream services need to
          // authorize requests (see AuthTokenClaims in @betterbasket/contracts).
          //
          // NOTE: "seller" is not a Better Auth `role` — it's derived here from
          // having an active organization (org owner/admin = acting as a
          // seller). `session` shape depends on the Better Auth version pinned
          // in package.json; verify `session.activeOrganizationId` is present
          // (organization plugin adds it) when upgrading.
          definePayload: ({ user, session }) => {
            const platformRole = (user as { role?: string }).role ?? "customer";
            const activeOrganizationId = (session as { activeOrganizationId?: string | null })
              ?.activeOrganizationId;
            return {
              role:
                platformRole === "admin" ? "admin" : activeOrganizationId ? "seller" : "customer",
              activeOrganizationId: activeOrganizationId ?? null,
            };
          },
          expirationTime: "15m",
        },
      }),
    ],
  });
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;

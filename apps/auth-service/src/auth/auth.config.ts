import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AuthTokenClaims, OrgRole } from "@betterbasket/contracts";
import { getAuthConfig } from "../config";
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
 * Platform role comes from the admin plugin. Organization claims are included
 * only while the user has an active membership; seller access is checked by
 * the downstream authorization layer rather than granted by a token claim.
 */
function memberRole(value: string): OrgRole | null {
  switch (value) {
    case "owner":
    case "admin":
    case "member":
      return value;
    default:
      return null;
  }
}

export async function createAuth() {
  const config = getAuthConfig();
  const { betterAuth } = await import("better-auth");
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  const { organization, admin, jwt } = await import("better-auth/plugins");

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BASE_URL,
    trustedOrigins: config.TRUSTED_ORIGINS,
    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: "lax", path: "/" },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
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
        jwks: {
          keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
          rotationInterval: 30 * 24 * 60 * 60,
          gracePeriod: 60 * 60,
        },
        jwt: {
          issuer: config.BASE_URL,
          audience: config.BASE_URL,
          definePayload: async ({ user, session }) => {
            const activeOrganizationId = session.activeOrganizationId as string | null | undefined;
            const membership = activeOrganizationId
              ? await db
                  .select({ role: schema.member.role })
                  .from(schema.member)
                  .where(
                    and(
                      eq(schema.member.organizationId, activeOrganizationId),
                      eq(schema.member.userId, user.id),
                    ),
                  )
                  .limit(1)
              : [];
            const orgRole = membership[0] ? memberRole(membership[0].role) : null;
            const issuedAt = Math.floor(Date.now() / 1000);
            return {
              sub: user.id,
              email: user.email,
              emailVerified: user.emailVerified,
              platformRole: user.role === "admin" ? "admin" : "customer",
              orgId: orgRole && activeOrganizationId ? activeOrganizationId : null,
              orgRole,
              iss: config.BASE_URL,
              aud: config.BASE_URL,
              iat: issuedAt,
              exp: issuedAt + 15 * 60,
              jti: randomUUID(),
            } satisfies AuthTokenClaims;
          },
          expirationTime: "15m",
        },
      }),
    ],
  });
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;

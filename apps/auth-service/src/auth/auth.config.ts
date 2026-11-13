import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AuthTokenClaims, OrgRole } from "@betterbasket/contracts";
import { AuditService, auditAction } from "../audit/audit.service";
import { getAuthConfig } from "../config";
import { pool } from "../db/pool";
import * as schema from "../db/schema";
import { auditLog } from "../db/schema.app";

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

function safeId(value: unknown): string | null {
  return typeof value === "string" && value.length <= 256 ? value : null;
}

function safeRequestId(value: string | null): string | null {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function requestIp(headers: Headers | undefined): string | null {
  return headers?.get("x-forwarded-for")?.split(",")[0] ?? headers?.get("x-real-ip") ?? null;
}

export async function createAuth() {
  const config = getAuthConfig();
  const { betterAuth } = await import("better-auth");
  const { createAuthMiddleware, isAPIError } = await import("better-auth/api");
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  const { organization, admin, jwt } = await import("better-auth/plugins");
  const audit = new AuditService(config.AUDIT_IP_SALT, async (row) => {
    await db.insert(auditLog).values(row);
  });

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
      onPasswordReset: async ({ user }, request) => {
        await audit.record({
          action: "password.reset",
          actorType: "anonymous",
          targetType: "user",
          targetId: user.id,
          ip: requestIp(request?.headers),
          requestId: safeRequestId(request?.headers.get("x-request-id") ?? null),
        });
      },
    },
    emailVerification: {
      afterEmailVerification: async (user, request) => {
        await audit.record({
          action: "email.verified",
          actorId: user.id,
          actorType: "user",
          targetType: "user",
          targetId: user.id,
          ip: requestIp(request?.headers),
          requestId: safeRequestId(request?.headers.get("x-request-id") ?? null),
        });
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    databaseHooks: {
      session: {
        delete: {
          after: async (session, context) => {
            if (context?.path !== "/sign-out") return;
            const headers = context.request?.headers;
            await audit.record({
              action: "sign_out.succeeded",
              actorId: session.userId,
              actorType: "user",
              targetType: "user",
              targetId: session.userId,
              ip: requestIp(headers),
              requestId: safeRequestId(headers?.get("x-request-id") ?? null),
            });
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const failed = isAPIError(ctx.context.returned);
        const action = auditAction(ctx.path, failed);
        if (!action) return;
        const body = ctx.body && typeof ctx.body === "object" ? ctx.body : {};
        const actorId =
          action === "sign_in.failed"
            ? null
            : (safeId(ctx.context.newSession?.user.id) ?? safeId(ctx.context.session?.user.id));
        const returned = ctx.context.returned;
        const member =
          returned && typeof returned === "object" && "member" in returned ? returned.member : null;
        const memberOrganizationId =
          member && typeof member === "object" && "organizationId" in member
            ? safeId(member.organizationId)
            : null;
        const targetId = action.startsWith("organization.")
          ? (safeId(body.organizationId) ?? memberOrganizationId)
          : safeId(body.userId);
        const headers = ctx.request?.headers;
        const ip = requestIp(headers);
        await audit.record({
          action,
          actorId,
          actorType: actorId ? "user" : "anonymous",
          targetType: action.startsWith("organization.") ? "organization" : "user",
          targetId:
            targetId ??
            (["sign_in.succeeded", "password.changed"].includes(action) ? actorId : null),
          requestId: safeRequestId(headers?.get("x-request-id") ?? null),
          ip,
          details: action.startsWith("sign_in.") ? { method: "email" } : {},
        });
      }),
    },
    plugins: [
      organization({
        // Any signed-in user can spin up a store; seller-service listens on
        // `afterCreateOrganization` (via Kafka, see contracts' SellerOnboarded
        // event) to create the matching Seller row.
        allowUserToCreateOrganization: true,
        organizationHooks: {
          afterAddMember: async ({ organization }) => {
            await audit.record({
              action: "organization.member_added",
              actorType: "system",
              targetType: "organization",
              targetId: organization.id,
            });
          },
        },
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
        adapter: {
          createJwk: async (key) => {
            const existingKeys = await db.select({ id: schema.jwks.id }).from(schema.jwks).limit(1);
            const rows = await db
              .insert(schema.jwks)
              .values({
                id: randomUUID(),
                publicKey: key.publicKey,
                privateKey: key.privateKey,
                createdAt: new Date(),
                expiresAt: key.expiresAt ?? null,
                alg: key.alg ?? null,
                crv: key.crv ?? null,
              })
              .returning();
            const created = rows[0];
            if (!created) throw new Error("JWKS key creation returned no row");
            await audit.record({
              action: existingKeys.length ? "jwks.key_rotated" : "jwks.key_created",
              actorType: "system",
              targetType: "jwks",
              targetId: created.id,
            });
            return { ...key, id: created.id, createdAt: created.createdAt };
          },
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

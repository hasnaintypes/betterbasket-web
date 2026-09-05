import { z } from "zod";
import { PlatformRoleSchema } from "./common.js";

/** Mirrors the subset of Better Auth's `user` table fields shared across services via JWT claims. */
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().min(1),
  image: z.string().url().nullish(),
  role: PlatformRoleSchema.default("customer"),
  emailVerified: z.boolean().default(false),
  banned: z.boolean().default(false),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

/** Decoded shape of the JWT issued by auth-service's `jwt` plugin (verified via JWKS). */
export const AuthTokenClaimsSchema = z.object({
  sub: z.string(), // user id
  email: z.string().email(),
  role: PlatformRoleSchema,
  activeOrganizationId: z.string().nullish(),
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  iat: z.number(),
});
export type AuthTokenClaims = z.infer<typeof AuthTokenClaimsSchema>;

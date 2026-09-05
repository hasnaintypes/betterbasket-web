/**
 * Placeholder Drizzle schema.
 *
 * Better Auth ships a CLI that generates this file for you from the exact
 * plugin list configured in `../auth/auth.config.ts` (organization, admin,
 * jwt each add their own tables/columns). Do NOT hand-write the auth tables —
 * regenerate whenever the plugin list changes:
 *
 *   pnpm --filter auth-service exec better-auth generate
 *
 * That command writes `user`, `session`, `account`, `verification`,
 * `organization`, `member`, `invitation`, `jwks`, etc. into this file (or a
 * file you point it at via `better-auth.config.ts`). Once generated, run
 * drizzle-kit to create/apply the actual SQL migration:
 *
 *   pnpm --filter auth-service exec drizzle-kit generate
 *   pnpm --filter auth-service exec drizzle-kit migrate
 */
export {};

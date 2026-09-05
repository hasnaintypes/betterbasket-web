import { z } from "zod";

/** Money is always stored/transferred as integer minor units (e.g. cents) + ISO currency code. */
export const MoneySchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3).default("USD"),
});
export type Money = z.infer<typeof MoneySchema>;

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginatedResultSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int(),
    limit: z.number().int(),
  });

/** Platform-wide roles, managed by Better Auth's `admin` plugin (see auth-service). */
export const PlatformRoleSchema = z.enum(["customer", "seller", "admin"]);
export type PlatformRole = z.infer<typeof PlatformRoleSchema>;

/** Roles inside a seller "organization" (Better Auth `organization` plugin). */
export const OrgRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

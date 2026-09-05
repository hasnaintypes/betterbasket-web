import { z } from "zod";
import { OrgRoleSchema } from "./common";

export const SellerOnboardingStatusSchema = z.enum([
  "pending",
  "stripe_pending",
  "active",
  "suspended",
]);
export type SellerOnboardingStatus = z.infer<typeof SellerOnboardingStatusSchema>;

/** A "seller" is a Better Auth Organization + extra commerce metadata owned by seller-service. */
export const SellerSchema = z.object({
  id: z.string(),
  organizationId: z.string(), // Better Auth organization.id
  storeName: z.string().min(2).max(100),
  slug: z.string().min(2).max(100),
  description: z.string().max(2000).nullish(),
  logoUrl: z.string().url().nullish(),
  stripeAccountId: z.string().nullish(),
  status: SellerOnboardingStatusSchema.default("pending"),
  createdAt: z.coerce.date(),
});
export type Seller = z.infer<typeof SellerSchema>;

export const SellerMemberSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  role: OrgRoleSchema,
});
export type SellerMember = z.infer<typeof SellerMemberSchema>;

export const CreateSellerInputSchema = SellerSchema.pick({
  storeName: true,
  slug: true,
  description: true,
});
export type CreateSellerInput = z.infer<typeof CreateSellerInputSchema>;

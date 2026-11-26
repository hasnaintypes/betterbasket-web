import { randomUUID } from "node:crypto";
import {
  CreateProductInputSchema,
  ProductStatusSchema,
  type CreateProductInput,
} from "@betterbasket/contracts";
import { productSlug } from "./slug";
import { lowestVariantPrice } from "./pricing";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LegacyProduct {
  organizationId?: unknown;
  sellerId?: unknown;
  slug?: unknown;
  status?: unknown;
  title?: unknown;
  description?: unknown;
  images?: unknown;
  category?: unknown;
  basePrice?: unknown;
  variants?: unknown;
}

/** Transform one legacy record without mutating it. Caller writes atomically with schemaVersion. */
export function migrateProductV2(
  legacy: LegacyProduct,
  sellerIdsByOrganization: Record<string, string>,
) {
  const organizationId = legacy.organizationId;
  const sellerId =
    typeof organizationId === "string" ? sellerIdsByOrganization[organizationId] : legacy.sellerId;
  if (typeof sellerId !== "string" || !uuid.test(sellerId)) {
    throw new Error("Legacy product requires an organization-to-seller UUID mapping");
  }
  const input: CreateProductInput = CreateProductInputSchema.parse({
    title: legacy.title,
    description: legacy.description,
    images: legacy.images,
    category: legacy.category,
    basePrice: legacy.basePrice,
    variants: legacy.variants,
  });
  const status = ProductStatusSchema.parse(legacy.status ?? "draft");
  const slug =
    typeof legacy.slug === "string" && legacy.slug.length >= 2 && legacy.slug.length <= 220
      ? legacy.slug
      : productSlug(input.title);
  return {
    ...input,
    sellerId,
    slug,
    variants: input.variants.map((variant) => ({ ...variant, variantId: randomUUID() })),
    status,
    sellerStatus: "other" as const,
    minPrice: lowestVariantPrice(input.basePrice, input.variants),
    version: 0,
    schemaVersion: 2,
  };
}

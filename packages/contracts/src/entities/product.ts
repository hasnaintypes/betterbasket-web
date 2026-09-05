import { z } from "zod";
import { MoneySchema } from "./common.js";

export const ProductStatusSchema = z.enum(["draft", "active", "archived"]);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const ProductVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  options: z.record(z.string(), z.string()).default({}), // e.g. { size: "M", color: "red" }
  price: MoneySchema,
  stock: z.number().int().nonnegative(),
});
export type ProductVariant = z.infer<typeof ProductVariantSchema>;

/** Lives in product-service's MongoDB collection. */
export const ProductSchema = z.object({
  id: z.string(),
  sellerId: z.string(), // seller-service Seller.id
  organizationId: z.string(), // Better Auth organization.id, for fast ownership checks
  title: z.string().min(2).max(200),
  slug: z.string(),
  description: z.string().max(5000).default(""),
  images: z.array(z.string().url()).default([]), // ImageKit URLs
  category: z.string(),
  basePrice: MoneySchema,
  variants: z.array(ProductVariantSchema).default([]),
  status: ProductStatusSchema.default("draft"),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Product = z.infer<typeof ProductSchema>;

export const CreateProductInputSchema = ProductSchema.pick({
  title: true,
  description: true,
  images: true,
  category: true,
  basePrice: true,
}).extend({
  variants: z.array(ProductVariantSchema.omit({ id: true })).default([]),
});
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

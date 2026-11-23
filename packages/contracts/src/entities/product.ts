import { z } from "zod";
import { MoneySchema } from "./common.js";

export const ProductStatusSchema = z.enum(["draft", "active", "unpublished", "archived"]);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const ProductSellerStatusSchema = z.enum(["active", "suspended", "other"]);
export type ProductSellerStatus = z.infer<typeof ProductSellerStatusSchema>;

export const ProductMoneySchema = MoneySchema.extend({ currency: z.literal("USD") });

export const ProductVariantSchema = z.object({
  variantId: z.uuid(),
  sku: z.string().min(1).max(64),
  options: z
    .record(z.string().min(1).max(40), z.string().min(1).max(100))
    .refine((options) => Object.keys(options).length <= 20, "Too many variant options")
    .default({}),
  price: ProductMoneySchema,
  stock: z.number().int().nonnegative(),
});
export type ProductVariant = z.infer<typeof ProductVariantSchema>;

/** Lives in product-service's MongoDB collection. */
export const ProductSchema = z.object({
  id: z.string(),
  sellerId: z.string(), // seller-service Seller.id
  title: z.string().min(2).max(200),
  slug: z.string().min(2).max(220),
  description: z
    .string()
    .max(5000)
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), "Description must be plain text")
    .default(""),
  images: z.array(z.url().max(2048)).max(12).default([]),
  category: z.string().min(1).max(100),
  basePrice: ProductMoneySchema,
  variants: z.array(ProductVariantSchema).max(100).default([]),
  status: ProductStatusSchema.default("draft"),
  sellerStatus: ProductSellerStatusSchema.default("other"),
  version: z.number().int().nonnegative().default(0),
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
})
  .extend({
    variants: z
      .array(ProductVariantSchema.omit({ variantId: true }))
      .max(100)
      .default([]),
  })
  .strict()
  .superRefine((input, context) => {
    const skus = new Set<string>();
    input.variants.forEach((variant, index) => {
      if (skus.has(variant.sku)) {
        context.addIssue({
          code: "custom",
          path: ["variants", index, "sku"],
          message: "SKU must be unique within a product",
        });
      }
      skus.add(variant.sku);
    });
  });
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

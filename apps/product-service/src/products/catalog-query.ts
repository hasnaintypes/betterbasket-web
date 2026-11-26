import { z } from "zod";

const decimal = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "Must be a nonnegative integer")
  .transform(Number)
  .pipe(z.number().int().safe().nonnegative());

export const CatalogQuerySchema = z
  .object({
    category: z.string().trim().min(1).max(100).optional(),
    minPrice: decimal.optional(),
    maxPrice: decimal.optional(),
    sellerId: z.uuid().optional(),
    q: z.string().trim().min(1).max(100).optional(),
    sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
    page: decimal.pipe(z.number().int().min(1).max(1000)).default(1),
    limit: decimal.pipe(z.number().int().min(1).max(100)).default(20),
  })
  .strict()
  .refine(
    (query) =>
      query.minPrice === undefined ||
      query.maxPrice === undefined ||
      query.minPrice <= query.maxPrice,
    {
      path: ["minPrice"],
      message: "minPrice must not exceed maxPrice",
    },
  );

export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

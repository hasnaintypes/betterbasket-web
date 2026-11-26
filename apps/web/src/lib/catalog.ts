import { createApiClient } from "@betterbasket/api-client";
import { z } from "zod";

const money = z.object({ amount: z.number().int().nonnegative(), currency: z.literal("USD") });
const product = z.object({
  _id: z.string(),
  sellerId: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string().default(""),
  images: z.array(z.string()).default([]),
  category: z.string(),
  basePrice: money,
  minPrice: z.number().int().nonnegative(),
  createdAt: z.string(),
});
const catalogPage = z.object({
  items: z.array(product),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
const taxonomy = z.object({
  version: z.number().int().positive(),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      children: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ),
});

export type CatalogProduct = z.infer<typeof product>;
export type CatalogPage = z.infer<typeof catalogPage>;
export type Taxonomy = z.infer<typeof taxonomy>;
export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface CatalogFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sellerId?: string;
  q?: string;
  sort: "newest" | "price_asc" | "price_desc";
  page: number;
}

const single = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;
const boundedInt = (value: string | undefined, min: number, max: number) => {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
};

export function normalizeCatalogFilters(
  raw: RawSearchParams,
  allowedCategories: readonly string[],
): CatalogFilters {
  const category = single(raw.category);
  const minPrice = boundedInt(single(raw.minPrice), 0, Number.MAX_SAFE_INTEGER);
  const maxPrice = boundedInt(single(raw.maxPrice), 0, Number.MAX_SAFE_INTEGER);
  const sellerId = single(raw.sellerId);
  const q = single(raw.q)?.trim().slice(0, 100);
  const sort = single(raw.sort);
  return {
    ...(category && allowedCategories.includes(category) ? { category } : {}),
    ...(minPrice !== undefined && (maxPrice === undefined || minPrice <= maxPrice)
      ? { minPrice }
      : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    ...(sellerId && z.uuid().safeParse(sellerId).success ? { sellerId } : {}),
    ...(q ? { q } : {}),
    sort: sort === "price_asc" || sort === "price_desc" ? sort : "newest",
    page: boundedInt(single(raw.page), 1, 1000) ?? 1,
  };
}

export function catalogPath(filters: CatalogFilters): string {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.minPrice !== undefined) params.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set("maxPrice", String(filters.maxPrice));
  if (filters.sellerId) params.set("sellerId", filters.sellerId);
  if (filters.q) params.set("q", filters.q);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/products?${query}` : "/products";
}

function publicClient() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) throw new Error("NEXT_PUBLIC_API_URL is required for catalog requests");
  return createApiClient({
    baseUrl,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      // Public cache keys must not vary with the API client's per-request ID.
      headers.delete("X-Request-Id");
      return fetch(input, {
        ...init,
        headers,
        next: { revalidate: 60 },
      } as RequestInit & { next: { revalidate: number } });
    },
  });
}

export async function getTaxonomy(): Promise<Taxonomy> {
  return publicClient().get("/api/categories", { auth: false, schema: taxonomy });
}

export async function getCatalog(filters: CatalogFilters, limit = 20): Promise<CatalogPage> {
  const path = `${catalogPath(filters)}${catalogPath(filters).includes("?") ? "&" : "?"}limit=${limit}`;
  return publicClient().get(`/api${path}`, { auth: false, schema: catalogPage });
}

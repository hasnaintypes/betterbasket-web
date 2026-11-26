import type { Metadata } from "next";
import Link from "next/link";
import React from "react";
import { redirect } from "next/navigation";
import { ApiError } from "@betterbasket/api-client";
import { ProductCard } from "@/components/product-card";
import {
  catalogPath,
  getCatalog,
  getTaxonomy,
  normalizeCatalogFilters,
  type CatalogFilters,
  type RawSearchParams,
  type Taxonomy,
} from "@/lib/catalog";

export const revalidate = 60;

type Props = { searchParams: Promise<RawSearchParams> };

const leafIds = (taxonomy: Taxonomy) =>
  taxonomy.categories.flatMap((parent) => parent.children.map((child) => child.id));

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const raw = await searchParams;
  try {
    const taxonomy = await getTaxonomy();
    const filters = normalizeCatalogFilters(raw, leafIds(taxonomy));
    return {
      title: filters.q ? `Search: ${filters.q} | BetterBasket` : "Shop products | BetterBasket",
      description: "Browse products from independent sellers.",
      alternates: { canonical: catalogPath(filters) },
    };
  } catch {
    return { title: "Shop products | BetterBasket", alternates: { canonical: "/products" } };
  }
}

function currentQuery(raw: RawSearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.append(key, value);
    else if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
  }
  return params.toString();
}

function FilterForm({ taxonomy, filters }: { taxonomy: Taxonomy; filters: CatalogFilters }) {
  return (
    <form
      action="/products"
      method="get"
      className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-6"
    >
      <div className="space-y-1 lg:col-span-2">
        <label htmlFor="catalog-q" className="text-sm font-medium">
          Search
        </label>
        <input
          id="catalog-q"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={filters.q ?? ""}
          placeholder="Product name"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="catalog-category" className="text-sm font-medium">
          Category
        </label>
        <select
          id="catalog-category"
          name="category"
          defaultValue={filters.category ?? ""}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
        >
          <option value="">All categories</option>
          {taxonomy.categories.map((parent) => (
            <optgroup key={parent.id} label={parent.name}>
              {parent.children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="catalog-min" className="text-sm font-medium">
          Minimum price
        </label>
        <select
          id="catalog-min"
          name="minPrice"
          defaultValue={filters.minPrice ?? ""}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
        >
          <option value="">Any minimum</option>
          {[2500, 5000, 10000, 20000].map((value) => (
            <option key={value} value={value}>
              ${value / 100}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="catalog-max" className="text-sm font-medium">
          Maximum price
        </label>
        <select
          id="catalog-max"
          name="maxPrice"
          defaultValue={filters.maxPrice ?? ""}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
        >
          <option value="">Any maximum</option>
          {[2500, 5000, 10000, 20000].map((value) => (
            <option key={value} value={value}>
              ${value / 100}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="catalog-sort" className="text-sm font-medium">
          Sort by
        </label>
        <select
          id="catalog-sort"
          name="sort"
          defaultValue={filters.sort}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
        >
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
      </div>
      <div className="space-y-1 sm:col-span-2 lg:col-span-5">
        <label htmlFor="catalog-seller" className="text-sm font-medium">
          Seller ID
        </label>
        <input
          id="catalog-seller"
          name="sellerId"
          type="text"
          defaultValue={filters.sellerId ?? ""}
          placeholder="Filter by seller ID"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
        />
      </div>
      <div className="flex items-end gap-3">
        <button
          type="submit"
          className="rounded-lg bg-primary px-5 py-2 font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Apply filters
        </button>
        <Link href="/products" className="text-sm underline underline-offset-4">
          Clear
        </Link>
      </div>
    </form>
  );
}

export default async function ProductsPage({ searchParams }: Props) {
  const raw = await searchParams;
  let taxonomy: Taxonomy;
  try {
    taxonomy = await getTaxonomy();
  } catch (error) {
    const requestId = error instanceof ApiError ? error.requestId : null;
    return (
      <main className="mx-auto max-w-6xl space-y-4 px-6 py-16" role="alert">
        <h1 className="text-3xl font-semibold">Products are unavailable</h1>
        <p>Please try again in a moment.</p>
        {requestId ? <p className="font-mono text-sm">Request ID: {requestId}</p> : null}
        <Link href="/products" className="underline">
          Try again
        </Link>
      </main>
    );
  }
  const filters = normalizeCatalogFilters(raw, leafIds(taxonomy));
  const canonical = catalogPath(filters);
  if (currentQuery(raw) !== (canonical.split("?")[1] ?? "")) redirect(canonical);

  let page;
  try {
    page = await getCatalog(filters);
  } catch (error) {
    const requestId = error instanceof ApiError ? error.requestId : null;
    return (
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-12">
        <h1 className="text-3xl font-semibold">Shop products</h1>
        <FilterForm taxonomy={taxonomy} filters={filters} />
        <div role="alert" className="rounded-2xl border border-border p-6">
          <h2 className="text-xl font-semibold">Products could not be loaded</h2>
          <p className="mt-2 text-muted-foreground">Please try again in a moment.</p>
          {requestId ? <p className="mt-2 font-mono text-sm">Request ID: {requestId}</p> : null}
          <Link href={canonical} className="mt-4 inline-block underline">
            Try again
          </Link>
        </div>
      </main>
    );
  }
  const hasPrevious = page.page > 1;
  const hasNext = page.page * page.limit < page.total;
  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-12">
      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">The catalog</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Shop products</h1>
        <p className="text-muted-foreground">Find a new favorite from independent sellers.</p>
      </div>
      <FilterForm taxonomy={taxonomy} filters={filters} />
      <section aria-label="Products" className="space-y-5">
        <p role="status" className="text-sm text-muted-foreground">
          {page.total} {page.total === 1 ? "product" : "products"} found
        </p>
        {page.items.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {page.items.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <h2 className="text-xl font-semibold">No products match these filters</h2>
            <p className="mt-2 text-muted-foreground">Try a different category or price range.</p>
            <Link href="/products" className="mt-4 inline-block underline">
              Clear filters
            </Link>
          </div>
        )}
      </section>
      {hasPrevious || hasNext ? (
        <nav
          aria-label="Product pages"
          className="flex items-center justify-between border-t border-border pt-5"
        >
          {hasPrevious ? (
            <Link href={catalogPath({ ...filters, page: page.page - 1 })} className="underline">
              Previous page
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">Page {page.page}</span>
          {hasNext ? (
            <Link href={catalogPath({ ...filters, page: page.page + 1 })} className="underline">
              Next page
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}

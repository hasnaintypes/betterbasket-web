import type { Metadata } from "next";
import Link from "next/link";
import React from "react";
import { ApiError } from "@betterbasket/api-client";
import { ProductCard } from "@/components/product-card";
import { getCatalog, getTaxonomy } from "@/lib/catalog";

export const revalidate = 60;
export const metadata: Metadata = {
  title: "BetterBasket | Discover independent stores",
  description: "Browse new arrivals and categories from independent sellers.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const [categories, arrivals] = await Promise.allSettled([
    getTaxonomy(),
    getCatalog({ sort: "newest", page: 1 }, 8),
  ]);
  const categoryRequestId =
    categories.status === "rejected" && categories.reason instanceof ApiError
      ? categories.reason.requestId
      : null;
  const arrivalsRequestId =
    arrivals.status === "rejected" && arrivals.reason instanceof ApiError
      ? arrivals.reason.requestId
      : null;
  return (
    <main>
      <section className="border-b border-border bg-muted/50 px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl space-y-6">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
            BetterBasket
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Find something worth bringing home.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Explore new finds from independent sellers, all in one place.
          </p>
          <Link
            href="/products"
            className="inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Browse products
          </Link>
        </div>
      </section>

      <section aria-labelledby="categories-heading" className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 id="categories-heading" className="text-2xl font-semibold">
            Shop by category
          </h2>
          <Link href="/products" className="text-sm font-medium underline underline-offset-4">
            View all
          </Link>
        </div>
        {categories.status === "fulfilled" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.value.categories.map((parent) => (
              <div key={parent.id} className="rounded-2xl border border-border bg-card p-5">
                <h3 className="mb-3 text-lg font-semibold">{parent.name}</h3>
                <ul className="flex flex-wrap gap-2">
                  {parent.children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={`/products?category=${encodeURIComponent(child.id)}`}
                        className="inline-flex rounded-full bg-muted px-3 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {child.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div role="alert" className="rounded-xl border border-border p-5 text-muted-foreground">
            <p>Categories are unavailable right now.</p>
            {categoryRequestId ? (
              <p className="mt-1 font-mono text-sm">Request ID: {categoryRequestId}</p>
            ) : null}
            <Link href="/" className="mt-2 inline-block underline">
              Try again
            </Link>
          </div>
        )}
      </section>

      <section aria-labelledby="arrivals-heading" className="mx-auto max-w-6xl px-6 pb-16">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 id="arrivals-heading" className="text-2xl font-semibold">
            New arrivals
          </h2>
          <Link href="/products" className="text-sm font-medium underline underline-offset-4">
            View all
          </Link>
        </div>
        {arrivals.status === "rejected" ? (
          <div role="alert" className="rounded-xl border border-border p-5 text-muted-foreground">
            <p>New arrivals are unavailable right now.</p>
            {arrivalsRequestId ? (
              <p className="mt-1 font-mono text-sm">Request ID: {arrivalsRequestId}</p>
            ) : null}
            <Link href="/" className="mt-2 inline-block underline">
              Try again
            </Link>
          </div>
        ) : arrivals.value.items.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {arrivals.value.items.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        ) : (
          <p role="status" className="rounded-xl border border-border p-5 text-muted-foreground">
            No products have arrived yet.
          </p>
        )}
      </section>
    </main>
  );
}

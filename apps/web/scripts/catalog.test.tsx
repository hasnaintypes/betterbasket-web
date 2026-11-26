import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ProductCard } from "../src/components/product-card";
import { catalogPath, getCatalog, getTaxonomy, normalizeCatalogFilters } from "../src/lib/catalog";
import { imageKitLoader, imageKitUrl } from "../src/lib/imagekit-loader";
import ProductsPage from "../src/app/(shop)/products/page";

test("catalog filters normalize invalid URL input and keep valid filters in the URL", () => {
  const filters = normalizeCatalogFilters(
    {
      category: "clothing",
      minPrice: "2500",
      maxPrice: "5000",
      sellerId: "not-a-uuid",
      q: "  blue shirt  ",
      sort: "price_asc",
      page: "2",
      "price[$gt]": "0",
    },
    ["clothing", "shoes"],
  );
  assert.deepEqual(filters, {
    category: "clothing",
    minPrice: 2500,
    maxPrice: 5000,
    q: "blue shirt",
    sort: "price_asc",
    page: 2,
  });
  assert.equal(
    catalogPath(filters),
    "/products?category=clothing&minPrice=2500&maxPrice=5000&q=blue+shirt&sort=price_asc&page=2",
  );
  assert.deepEqual(normalizeCatalogFilters({ page: "1001", minPrice: "90", maxPrice: "20" }, []), {
    maxPrice: 20,
    sort: "newest",
    page: 1,
  });
});

test("public API client sends no bearer token and requests 60-second revalidation", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), init });
    const body = String(input).endsWith("/api/categories")
      ? {
          version: 1,
          categories: [
            { id: "fashion", name: "Fashion", children: [{ id: "clothing", name: "Clothing" }] },
          ],
        }
      : { items: [], total: 0, page: 1, limit: 8 };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const categories = await getTaxonomy();
    const page = await getCatalog({ category: "clothing", sort: "newest", page: 1 }, 8);
    assert.equal(categories.categories[0]?.children[0]?.id, "clothing");
    assert.equal(page.total, 0);
    assert.equal(
      requests[1]?.url,
      "https://api.example.test/api/products?category=clothing&limit=8",
    );
    assert.equal(requests[0]?.init?.next?.revalidate, 60);
    assert.equal(new Headers(requests[0]?.init?.headers).has("authorization"), false);
    assert.equal(new Headers(requests[0]?.init?.headers).has("x-request-id"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalUrl;
  }
});

test("ImageKit loader constrains hosts and product cards show a useful empty image state", () => {
  assert.equal(imageKitUrl("https://ik.imagekit.io/store/item.jpg"), true);
  assert.equal(imageKitUrl("https://attacker.example/item.jpg"), false);
  assert.equal(
    imageKitLoader({ src: "https://ik.imagekit.io/store/item.jpg", width: 320 }),
    "https://ik.imagekit.io/store/item.jpg?tr=w-320%2Cq-80",
  );
  assert.throws(() => imageKitLoader({ src: "https://attacker.example/item.jpg", width: 320 }));
  const html = renderToStaticMarkup(
    <ProductCard
      product={{
        _id: "p1",
        sellerId: "s1",
        title: "Blue Shirt",
        slug: "blue-shirt",
        description: "",
        images: [],
        category: "clothing",
        basePrice: { amount: 2500, currency: "USD" },
        minPrice: 2500,
        createdAt: new Date().toISOString(),
      }}
    />,
  );
  assert.match(html, /Blue Shirt/);
  assert.match(html, /\$25\.00/);
  assert.match(html, /Image unavailable/);
});

test("the listing renders an accessible empty state and filter controls", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  globalThis.fetch = (async (input) =>
    new Response(
      JSON.stringify(
        String(input).endsWith("/api/categories")
          ? {
              version: 1,
              categories: [
                {
                  id: "fashion",
                  name: "Fashion",
                  children: [{ id: "clothing", name: "Clothing" }],
                },
              ],
            }
          : { items: [], total: 0, page: 1, limit: 20 },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  try {
    const html = renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve({}) }));
    assert.match(html, /No products match these filters/);
    assert.match(html, /label for="catalog-category"/);
    assert.match(html, /label for="catalog-min"/);
    assert.match(html, /Apply filters/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalUrl;
  }
});

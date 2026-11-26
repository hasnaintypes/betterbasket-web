import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

const uri = process.env.PRODUCT_TEST_MONGODB_URI;
if (!uri) throw new Error("PRODUCT_TEST_MONGODB_URI is required for integration tests");
const database = `ci_${randomUUID().replaceAll("-", "")}`;
const sellerId = randomUUID();
let connection;
let model;
let service;
let querySchema;

before(async () => {
  connection = await mongoose
    .createConnection(uri, { dbName: database, autoIndex: false })
    .asPromise();
  const { ProductDocument, ProductSchema } =
    await import("../dist/products/schemas/product.schema.js");
  const { ProductsService } = await import("../dist/products/products.service.js");
  ({ CatalogQuerySchema: querySchema } = await import("../dist/products/catalog-query.js"));
  model = connection.model(ProductDocument.name, ProductSchema);
  await model.createIndexes();
  service = new ProductsService(model);

  const products = Array.from({ length: 56 }, (_, index) => ({
    sellerId,
    title: `Catalog Item ${index}`,
    slug: `catalog-item-${index}-${randomUUID().slice(0, 6)}`,
    description: "Synthetic catalog test item",
    category: index % 2 === 0 ? "clothing" : "shoes",
    basePrice: { amount: 100 + index, currency: "USD" },
    minPrice: 100 + index,
    variants: [
      {
        variantId: randomUUID(),
        sku: `CAT-${index}`,
        options: {},
        price: { amount: 100 + index, currency: "USD" },
        stock: 2,
      },
    ],
    status: index < 51 ? "active" : "draft",
    sellerStatus: index === 50 ? "suspended" : "active",
    version: 0,
    schemaVersion: 2,
  }));
  await model.insertMany(products);
});

after(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
});

test("public pagination shows only 50 active visible products and omits internal fields", async () => {
  const page = await service.findPublished(querySchema.parse({ page: "1", limit: "20" }));
  assert.equal(page.total, 50);
  assert.equal(page.items.length, 20);
  for (const item of page.items) {
    assert.equal(item.status, "active");
    assert.equal("version" in item, false);
    assert.equal("sellerStatus" in item, false);
    assert.equal("schemaVersion" in item, false);
  }
  const next = await service.findPublished(querySchema.parse({ page: "2", limit: "20" }));
  assert.equal(next.total, 50);
  assert.equal(next.items.length, 20);
  assert.equal(new Set([...page.items, ...next.items].map((item) => String(item._id))).size, 40);
});

test("category and minimum price combine and price sort is stable", async () => {
  const page = await service.findPublished(
    querySchema.parse({
      category: "clothing",
      minPrice: "125",
      sort: "price_asc",
      limit: "100",
    }),
  );
  assert.equal(page.total, 12);
  assert.equal(page.items.length, 12);
  assert.ok(page.items.every((item) => item.category === "clothing" && item.minPrice >= 125));
  assert.deepEqual(
    page.items.map((item) => item.minPrice),
    [...page.items.map((item) => item.minPrice)].sort((a, b) => a - b),
  );
});

test("text and seller filters retain public visibility", async () => {
  const page = await service.findPublished(
    querySchema.parse({
      q: "Catalog Item 4",
      sellerId,
      limit: "100",
    }),
  );
  assert.ok(page.total > 0);
  assert.ok(page.items.every((item) => item.sellerId === sellerId));
  assert.ok(page.items.every((item) => item.status === "active"));
});

test("the category price query uses the compound index", async () => {
  const explanation = await model
    .find({
      status: "active",
      sellerStatus: "active",
      category: "clothing",
      minPrice: { $gte: 125 },
    })
    .sort({ minPrice: 1, _id: 1 })
    .hint("storefront_category_price")
    .explain("executionStats");
  assert.match(JSON.stringify(explanation.queryPlanner.winningPlan), /storefront_category_price/);
});

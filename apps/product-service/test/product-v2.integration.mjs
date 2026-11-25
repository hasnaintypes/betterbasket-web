import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

// TODO(#62): Run with a nonproduction Mongo URL that can create and drop a test database; record SKU and index evidence on the issue.
const uri = process.env.PRODUCT_TEST_MONGODB_URI;
if (!uri) throw new Error("PRODUCT_TEST_MONGODB_URI is required for integration tests");
const database = `ci_${randomUUID().replaceAll("-", "")}`;
const sellerA = randomUUID();
const sellerB = randomUUID();
const variantId = () => randomUUID();
let connection;
let model;

before(async () => {
  connection = await mongoose
    .createConnection(uri, { dbName: database, autoIndex: false })
    .asPromise();
  const { ProductDocument, ProductSchema } =
    await import("../dist/products/schemas/product.schema.js");
  model = connection.model(ProductDocument.name, ProductSchema);
  await model.createIndexes();
});

after(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
});

function product(sellerId, slug, sku) {
  return {
    sellerId,
    title: "Test Product",
    slug,
    description: "Plain text",
    category: "test-category",
    basePrice: { amount: 100, currency: "USD" },
    variants: [
      {
        variantId: variantId(),
        sku,
        options: {},
        price: { amount: 100, currency: "USD" },
        stock: 2,
      },
    ],
    status: "active",
    sellerStatus: "active",
    version: 0,
    schemaVersion: 2,
  };
}

test("SKU is unique across products for one seller but reusable by another seller", async () => {
  await model.create(product(sellerA, "product-a-abc123", "SAME-SKU"));
  await assert.rejects(
    model.create(product(sellerA, "product-b-def456", "SAME-SKU")),
    (error) => error.code === 11000 && error.keyPattern?.sellerId === 1,
  );
  await model.create(product(sellerB, "product-c-ghi789", "SAME-SKU"));
  assert.equal(await model.countDocuments({ "variants.sku": "SAME-SKU" }), 2);
});

test("storefront status, seller status and category query uses the compound index", async () => {
  const explanation = await model
    .find({
      status: "active",
      sellerStatus: "active",
      category: "test-category",
    })
    .sort({ createdAt: -1 })
    .hint("storefront_filter")
    .explain("executionStats");
  assert.match(JSON.stringify(explanation.queryPlanner.winningPlan), /storefront_filter/);
});

import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { CategoriesController } from "./categories.controller";
import { assertSeedEnvironment, seedProducts } from "./seed";
import { assertKnownCategory, categories, categoryIds } from "./catalog";
import { ProductsService } from "../products/products.service";
import { ProductDocument, ProductSchema } from "../products/schemas/product.schema";

describe("category taxonomy", () => {
  it("returns a versioned two-level public taxonomy with unique leaf ids", () => {
    expect(new CategoriesController().list()).toBe(categories);
    expect(categories.version).toBe(1);
    expect(categories.categories.every((parent) => parent.children.length > 0)).toBe(true);
    expect(new Set(categoryIds).size).toBe(categoryIds.length);
  });

  it("rejects unknown categories before product creation and in model validation", async () => {
    expect(() => assertKnownCategory("unknown")).toThrow("Unknown product category");
    const create = jest.fn();
    const service = new ProductsService({ create } as never);
    await expect(
      service.create(randomUUID(), {
        title: "Unknown item",
        description: "",
        images: [],
        category: "unknown",
        basePrice: { amount: 100, currency: "USD" },
        variants: [],
      }),
    ).rejects.toThrow("Unknown product category");
    expect(create).not.toHaveBeenCalled();

    const model = mongoose.model(ProductDocument.name, ProductSchema);
    const document = new model({
      sellerId: randomUUID(),
      title: "Unknown item",
      slug: "unknown-item-123456",
      category: "unknown",
      basePrice: { amount: 100, currency: "USD" },
    });
    await expect(document.validate()).rejects.toThrow();
  });

  it("seeds repeatably and refuses production", async () => {
    const products = new Map<string, Record<string, unknown>>();
    const store = {
      updateOne: jest.fn(
        async (filter: { slug: string }, update: { $setOnInsert: Record<string, unknown> }) => {
          if (!products.has(filter.slug)) products.set(filter.slug, update.$setOnInsert);
        },
      ),
    };
    await seedProducts(store, 6, 2);
    expect(products.size).toBe(6);
    await seedProducts(store, 6, 2);
    expect(products.size).toBe(6);
    expect(store.updateOne).toHaveBeenCalledTimes(12);
    expect(new Set([...products.values()].map((product) => product.sellerId)).size).toBe(2);
    expect(() => assertSeedEnvironment("production")).toThrow(/development or staging/);
    expect(() => assertSeedEnvironment("development")).not.toThrow();
    expect(() => assertSeedEnvironment("staging")).not.toThrow();
  });
});

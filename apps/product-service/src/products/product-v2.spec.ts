import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { CreateProductInputSchema } from "@betterbasket/contracts";
import { migrateProductV2 } from "./migration";
import { ProductsService } from "./products.service";
import { ProductDocument, ProductSchema } from "./schemas/product.schema";
import { isSellerSkuDuplicate, isSlugDuplicate, productSlug } from "./slug";
import { CatalogQuerySchema } from "./catalog-query";

const sellerId = randomUUID();
const input = {
  title: "Blue Shirt",
  description: "A plain blue shirt",
  images: [],
  category: "clothing",
  basePrice: { amount: 1999, currency: "USD" as const },
  variants: [
    {
      sku: "BLUE-M",
      options: { size: "M" },
      price: { amount: 1999, currency: "USD" as const },
      stock: 3,
    },
  ],
};

describe("product v2 model", () => {
  const model = mongoose.model(ProductDocument.name, ProductSchema);

  it("declares the seller-SKU and storefront indexes", () => {
    const indexes = ProductSchema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        [
          { sellerId: 1, "variants.sku": 1 },
          expect.objectContaining({ unique: true, name: "seller_variant_sku_unique" }),
        ],
        [
          { status: 1, sellerStatus: 1, category: 1, createdAt: -1 },
          expect.objectContaining({ name: "storefront_filter" }),
        ],
      ]),
    );
  });

  it("rejects negative, fractional and non-USD money and duplicate SKUs within a product", async () => {
    expect(CreateProductInputSchema.safeParse(input).success).toBe(true);
    expect(
      CreateProductInputSchema.safeParse({ ...input, basePrice: { amount: -1, currency: "USD" } })
        .success,
    ).toBe(false);
    expect(
      CreateProductInputSchema.safeParse({ ...input, basePrice: { amount: 1.5, currency: "USD" } })
        .success,
    ).toBe(false);
    expect(
      CreateProductInputSchema.safeParse({ ...input, basePrice: { amount: 1, currency: "EUR" } })
        .success,
    ).toBe(false);
    expect(
      CreateProductInputSchema.safeParse({
        ...input,
        variants: [input.variants[0], input.variants[0]],
      }).success,
    ).toBe(false);
    const document = new model({
      ...input,
      sellerId,
      slug: "blue-shirt-abc123",
      minPrice: 1999,
      variants: [{ ...input.variants[0], variantId: randomUUID(), stock: -1 }],
    });
    await expect(document.validate()).rejects.toThrow();
  });

  it("uses a six-character random slug suffix and retries only slug collisions", async () => {
    expect(productSlug("Blue Shirt", "abc123")).toBe("blue-shirt-abc123");
    expect(isSlugDuplicate({ code: 11000, keyPattern: { slug: 1 } })).toBe(true);
    expect(isSlugDuplicate({ code: 11000, keyPattern: { sellerId: 1, "variants.sku": 1 } })).toBe(
      false,
    );
    expect(
      isSellerSkuDuplicate({ code: 11000, keyPattern: { sellerId: 1, "variants.sku": 1 } }),
    ).toBe(true);
    const create = jest
      .fn()
      .mockRejectedValueOnce({ code: 11000, keyPattern: { slug: 1 } })
      .mockResolvedValueOnce({ toObject: () => ({ sellerId }) });
    const service = new ProductsService({ create } as never);
    await expect(service.create(sellerId, input)).resolves.toEqual({ sellerId });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].sellerId).toBe(sellerId);
    expect(create.mock.calls[0][0].minPrice).toBe(1999);
    expect(create.mock.calls[0][0]).not.toHaveProperty("organizationId");
    expect(create.mock.calls[0][0].variants[0].variantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(create.mock.calls[0][0].variants[0].variantId).toBe(
      create.mock.calls[1][0].variants[0].variantId,
    );
  });

  it("filters both public reads by active product and seller status", async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ lean });
    const limit = jest.fn().mockReturnValue({ sort });
    const skip = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ skip });
    const countDocuments = jest.fn().mockResolvedValue(0);
    const findOne = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ id: "p" }) });
    const service = new ProductsService({ find, countDocuments, findOne } as never);
    await service.findPublished(CatalogQuerySchema.parse({ category: "clothing" }));
    expect(find).toHaveBeenCalledWith(
      { status: "active", sellerStatus: "active", category: "clothing" },
      { version: 0, sellerStatus: 0, schemaVersion: 0, __v: 0 },
    );
    await service.findBySlug("blue-shirt-abc123");
    expect(findOne).toHaveBeenCalledWith(
      { slug: "blue-shirt-abc123", status: "active", sellerStatus: "active" },
      { version: 0, sellerStatus: 0, schemaVersion: 0, __v: 0 },
    );
  });
});

describe("legacy product migration", () => {
  it("requires an explicit seller mapping and assigns stable UUIDs", () => {
    const legacy = {
      ...input,
      organizationId: "org-1",
      sellerId: "old-user-id",
      status: "active",
      slug: "legacy-slug",
    };
    expect(() => migrateProductV2(legacy, {})).toThrow(/mapping/);
    const result = migrateProductV2(legacy, { "org-1": sellerId });
    expect(result.sellerId).toBe(sellerId);
    expect(result).not.toHaveProperty("organizationId");
    expect(result.status).toBe("active");
    expect(result.sellerStatus).toBe("other");
    expect(result.variants[0]!.variantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.schemaVersion).toBe(2);
  });
});

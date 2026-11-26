import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CatalogQuerySchema } from "./catalog-query";
import { lowestVariantPrice } from "./pricing";
import { ProductsService } from "./products.service";
import { ProductSchema } from "./schemas/product.schema";
import { ProductsController } from "./products.controller";

describe("public catalog query", () => {
  it("accepts typed filters and rejects operator-style, repeated, malformed, and unbounded params", () => {
    const sellerId = randomUUID();
    expect(
      CatalogQuerySchema.parse({
        category: "clothing",
        minPrice: "100",
        maxPrice: "200",
        sellerId,
        q: "blue shirt",
        sort: "price_asc",
        page: "2",
        limit: "10",
      }),
    ).toEqual({
      category: "clothing",
      minPrice: 100,
      maxPrice: 200,
      sellerId,
      q: "blue shirt",
      sort: "price_asc",
      page: 2,
      limit: 10,
    });
    for (const bad of [
      { "price[$gt]": "0" },
      { "minPrice[$gt]": "0" },
      { minPrice: { $gt: "0" } },
      { minPrice: ["0", "1"] },
      { minPrice: "-1" },
      { minPrice: "1.5" },
      { minPrice: "200", maxPrice: "100" },
      { page: "1001" },
      { page: "0" },
      { limit: "101" },
      { q: "" },
      { sort: "unknown" },
    ]) {
      expect(CatalogQuerySchema.safeParse(bad).success).toBe(false);
    }
  });

  it("derives the lowest variant price and declares price indexes", () => {
    expect(
      lowestVariantPrice({ amount: 300 }, [{ price: { amount: 200 } }, { price: { amount: 100 } }]),
    ).toBe(100);
    expect(lowestVariantPrice({ amount: 300 }, [])).toBe(300);
    expect(() => lowestVariantPrice({ amount: 300 }, [{ price: { amount: -1 } }])).toThrow();
    expect(ProductSchema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { status: 1, sellerStatus: 1, minPrice: 1, _id: 1 },
          expect.objectContaining({ name: "storefront_price" }),
        ],
        [
          { status: 1, sellerStatus: 1, category: 1, minPrice: 1, _id: 1 },
          expect.objectContaining({ name: "storefront_category_price" }),
        ],
      ]),
    );
  });

  it("builds only allow-listed Mongo filters and stable price ordering", async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ lean });
    const limit = jest.fn().mockReturnValue({ sort });
    const skip = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ skip });
    const countDocuments = jest.fn().mockResolvedValue(0);
    const service = new ProductsService({ find, countDocuments } as never);
    const sellerId = randomUUID();
    await service.findPublished(
      CatalogQuerySchema.parse({
        category: "clothing",
        minPrice: "100",
        maxPrice: "200",
        sellerId,
        q: "blue",
        sort: "price_desc",
        page: "2",
        limit: "10",
      }),
    );
    expect(find).toHaveBeenCalledWith(
      {
        status: "active",
        sellerStatus: "active",
        category: "clothing",
        sellerId,
        minPrice: { $gte: 100, $lte: 200 },
        $text: { $search: "blue" },
      },
      { version: 0, sellerStatus: 0, schemaVersion: 0, __v: 0 },
    );
    expect(skip).toHaveBeenCalledWith(10);
    expect(limit).toHaveBeenCalledWith(10);
    expect(sort).toHaveBeenCalledWith({ minPrice: -1, _id: -1 });
    expect(countDocuments).toHaveBeenCalledWith(find.mock.calls[0][0]);
  });

  it("returns 404 for a slug that is not publicly visible", async () => {
    const findOne = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const service = new ProductsService({ findOne } as never);
    await expect(service.findBySlug("hidden-item")).rejects.toMatchObject({ status: 404 });
    expect(findOne.mock.calls[0][0]).toEqual({
      slug: "hidden-item",
      status: "active",
      sellerStatus: "active",
    });
  });

  it("returns HTTP 400 for operator-style params and sets public cache headers", async () => {
    const findPublished = jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    const getBySlug = jest.fn().mockResolvedValue({ slug: "example" });
    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: { findPublished, getBySlug } }],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const invalid = await request(app.getHttpServer()).get("/products?price%5B%24gt%5D=0");
      expect(invalid.status).toBe(400);
      expect(findPublished).not.toHaveBeenCalled();
      const valid = await request(app.getHttpServer()).get(
        "/products?category=clothing&minPrice=100",
      );
      expect(valid.status).toBe(200);
      expect(valid.headers["cache-control"]).toBe("public, max-age=30");
      expect(findPublished).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "clothing",
          minPrice: 100,
          page: 1,
          limit: 20,
        }),
      );
      const detail = await request(app.getHttpServer()).get("/products/example");
      expect(detail.headers["cache-control"]).toBe("public, max-age=30");
    } finally {
      await app.close();
    }
  });
});

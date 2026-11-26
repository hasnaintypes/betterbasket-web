import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { randomUUID } from "node:crypto";
import type { CreateProductInput } from "@betterbasket/contracts";
import { ProductDocument, type ProductMongoDocument } from "./schemas/product.schema";
import { isSellerSkuDuplicate, isSlugDuplicate, productSlug } from "./slug";
import { assertKnownCategory } from "../categories/catalog";
import type { CatalogQuery } from "./catalog-query";
import { lowestVariantPrice } from "./pricing";

const publicProjection = { version: 0, sellerStatus: 0, schemaVersion: 0, __v: 0 };

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(ProductDocument.name) private readonly productModel: Model<ProductMongoDocument>,
  ) {}

  async create(sellerId: string, input: CreateProductInput) {
    assertKnownCategory(input.category);
    const variants = input.variants.map((variant) => ({ ...variant, variantId: randomUUID() }));
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await this.productModel.create({
          ...input,
          variants,
          sellerId,
          slug: productSlug(input.title),
          status: "draft",
          sellerStatus: "other",
          minPrice: lowestVariantPrice(input.basePrice, variants),
          version: 0,
          schemaVersion: 2,
        });
        return created.toObject();
      } catch (error) {
        if (isSellerSkuDuplicate(error))
          throw new ConflictException("SKU already used by this seller");
        if (!isSlugDuplicate(error)) throw error;
      }
    }
    throw new ConflictException("Could not allocate a unique product slug");
  }

  async findPublished(query: CatalogQuery) {
    const { page, limit, category, minPrice, maxPrice, sellerId, q, sort } = query;
    if (category) assertKnownCategory(category);
    const filter: {
      status: "active";
      sellerStatus: "active";
      category?: string;
      sellerId?: string;
      minPrice?: { $gte?: number; $lte?: number };
      $text?: { $search: string };
    } = { status: "active", sellerStatus: "active" };
    if (category) filter.category = category;
    if (sellerId) filter.sellerId = sellerId;
    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.minPrice = {
        ...(minPrice !== undefined ? { $gte: minPrice } : {}),
        ...(maxPrice !== undefined ? { $lte: maxPrice } : {}),
      };
    }
    if (q) filter.$text = { $search: q };
    const sortOrder: Record<string, 1 | -1> =
      sort === "newest"
        ? { createdAt: -1 as const, _id: -1 as const }
        : {
            minPrice: (sort === "price_asc" ? 1 : -1) as 1 | -1,
            _id: (sort === "price_asc" ? 1 : -1) as 1 | -1,
          };
    const [items, total] = await Promise.all([
      this.productModel
        .find(filter, publicProjection)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort(sortOrder)
        .lean(),
      this.productModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  async findBySeller(sellerId: string) {
    return this.productModel.find({ sellerId }).sort({ createdAt: -1 }).lean();
  }

  async findBySlug(slug: string) {
    const product = await this.productModel
      .findOne({ slug, status: "active", sellerStatus: "active" }, publicProjection)
      .lean();
    if (!product) throw new NotFoundException(`Product '${slug}' not found`);
    return product;
  }
}

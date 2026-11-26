import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { randomUUID } from "node:crypto";
import type { CreateProductInput, PaginationQuery } from "@betterbasket/contracts";
import { ProductDocument, type ProductMongoDocument } from "./schemas/product.schema";
import { isSellerSkuDuplicate, isSlugDuplicate, productSlug } from "./slug";
import { assertKnownCategory } from "../categories/catalog";

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

  async findPublished({ page, limit }: PaginationQuery, category?: string) {
    const filter = {
      status: "active" as const,
      sellerStatus: "active" as const,
      ...(category ? { category } : {}),
    };
    const [items, total] = await Promise.all([
      this.productModel
        .find(filter)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 })
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
      .findOne({ slug, status: "active", sellerStatus: "active" })
      .lean();
    if (!product) throw new NotFoundException(`Product '${slug}' not found`);
    return product;
  }
}

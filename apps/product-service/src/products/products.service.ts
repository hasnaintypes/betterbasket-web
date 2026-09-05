import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { slugify } from "@betterbasket/utils";
import type { CreateProductInput, PaginationQuery } from "@betterbasket/contracts";
import { ProductDocument, type ProductMongoDocument } from "./schemas/product.schema";

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(ProductDocument.name) private readonly productModel: Model<ProductMongoDocument>,
  ) {}

  async create(sellerId: string, organizationId: string, input: CreateProductInput) {
    const created = await this.productModel.create({
      ...input,
      sellerId,
      organizationId,
      slug: `${slugify(input.title)}-${Date.now().toString(36)}`,
      status: "draft",
    });
    return created.toObject();
  }

  async findPublished({ page, limit }: PaginationQuery, category?: string) {
    const filter = { status: "active" as const, ...(category ? { category } : {}) };
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
    const product = await this.productModel.findOne({ slug, status: "active" }).lean();
    if (!product) throw new NotFoundException(`Product '${slug}' not found`);
    return product;
  }
}

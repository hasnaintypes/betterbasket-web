import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";
import type { ProductSellerStatus, ProductStatus } from "@betterbasket/contracts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plainText = (value: string) => !/<\/?[a-z][^>]*>/i.test(value);

@Schema({ _id: false })
class MoneySubdocument {
  @Prop({ required: true, min: 0, validate: Number.isInteger })
  amount!: number;

  @Prop({ type: String, required: true, enum: ["USD"] })
  currency!: "USD";
}
const moneySchema = SchemaFactory.createForClass(MoneySubdocument);

@Schema({ _id: false })
export class VariantSubdocument {
  @Prop({ required: true, match: uuidPattern })
  variantId!: string;

  @Prop({ required: true, minlength: 1, maxlength: 64 })
  sku!: string;

  @Prop({
    type: Object,
    default: {},
    validate: (options: Record<string, string>) =>
      Object.keys(options).length <= 20 &&
      Object.entries(options).every(
        ([key, value]) =>
          key.length >= 1 &&
          key.length <= 40 &&
          typeof value === "string" &&
          value.length >= 1 &&
          value.length <= 100,
      ),
  })
  options!: Record<string, string>;

  @Prop({ type: moneySchema, required: true })
  price!: MoneySubdocument;

  @Prop({ required: true, min: 0, validate: Number.isInteger })
  stock!: number;
}
const variantSchema = SchemaFactory.createForClass(VariantSubdocument);

@Schema({ timestamps: true, collection: "products", strict: true })
export class ProductDocument {
  @Prop({ required: true, match: uuidPattern })
  sellerId!: string;

  @Prop({ required: true, minlength: 2, maxlength: 200 })
  title!: string;

  @Prop({ required: true, unique: true, minlength: 2, maxlength: 220 })
  slug!: string;

  @Prop({ default: "", maxlength: 5000, validate: plainText })
  description!: string;

  @Prop({
    type: [String],
    default: [],
    validate: (images: string[]) =>
      images.length <= 12 && images.every((image) => image.length <= 2048 && URL.canParse(image)),
  })
  images!: string[];

  @Prop({ required: true, minlength: 1, maxlength: 100 })
  category!: string;

  @Prop({ type: moneySchema, required: true })
  basePrice!: MoneySubdocument;

  @Prop({
    type: [variantSchema],
    default: [],
    validate: {
      validator: (variants: VariantSubdocument[]) =>
        variants.length <= 100 &&
        new Set(variants.map((variant) => variant.sku)).size === variants.length &&
        new Set(variants.map((variant) => variant.variantId)).size === variants.length,
      message: "Variant SKUs and IDs must be unique within a product",
    },
  })
  variants!: VariantSubdocument[];

  @Prop({
    type: String,
    enum: ["draft", "active", "unpublished", "archived"],
    default: "draft",
    required: true,
  })
  status!: ProductStatus;

  @Prop({ type: String, enum: ["active", "suspended", "other"], default: "other", required: true })
  sellerStatus!: ProductSellerStatus;

  @Prop({ default: 0, min: 0, validate: Number.isInteger, required: true })
  version!: number;

  @Prop({ default: 2, enum: [2], required: true })
  schemaVersion!: number;
}

export type ProductMongoDocument = HydratedDocument<ProductDocument>;
export const ProductSchema = SchemaFactory.createForClass(ProductDocument);
ProductSchema.index(
  { sellerId: 1, "variants.sku": 1 },
  {
    unique: true,
    partialFilterExpression: { "variants.sku": { $type: "string" } },
    name: "seller_variant_sku_unique",
  },
);
ProductSchema.index(
  { status: 1, sellerStatus: 1, category: 1, createdAt: -1 },
  { name: "storefront_filter" },
);
ProductSchema.index({ title: "text", description: "text" });
ProductSchema.index({ sellerId: 1, status: 1 });

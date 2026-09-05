import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import type { Money, ProductStatus } from "@betterbasket/contracts";

@Schema({ _id: false })
class VariantSubdocument {
  @Prop({ required: true })
  sku!: string;

  @Prop({ type: Object, default: {} })
  options!: Record<string, string>;

  @Prop({ type: Object, required: true })
  price!: Money;

  @Prop({ required: true, min: 0 })
  stock!: number;
}

@Schema({ timestamps: true, collection: "products" })
export class ProductDocument {
  @Prop({ required: true, index: true })
  sellerId!: string;

  @Prop({ required: true, index: true })
  organizationId!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true, unique: true, index: true })
  slug!: string;

  @Prop({ default: "" })
  description!: string;

  @Prop({ type: [String], default: [] })
  images!: string[];

  @Prop({ required: true, index: true })
  category!: string;

  @Prop({ type: Object, required: true })
  basePrice!: Money;

  @Prop({ type: [VariantSubdocument], default: [] })
  variants!: VariantSubdocument[];

  @Prop({ enum: ["draft", "active", "archived"], default: "draft", index: true })
  status!: ProductStatus;
}

export type ProductMongoDocument = HydratedDocument<ProductDocument>;
export const ProductSchema = SchemaFactory.createForClass(ProductDocument);

import mongoose from "mongoose";
import { assertSeedEnvironment, seedProducts } from "../src/categories/seed";
import { ProductDocument, ProductSchema } from "../src/products/schemas/product.schema";

async function main() {
  assertSeedEnvironment(process.env.NODE_ENV);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required for synthetic seeding");
  const productCount = Number(process.argv[2] ?? "20");
  const sellerCount = Number(process.argv[3] ?? "3");
  await mongoose.connect(uri);
  try {
    const model = mongoose.model(ProductDocument.name, ProductSchema);
    await model.init();
    await seedProducts(model, productCount, sellerCount);
    process.stdout.write(
      `Seeded up to ${productCount} synthetic products across ${sellerCount} sellers.\n`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Seeding failed"}\n`);
  process.exitCode = 1;
});

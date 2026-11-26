import { existsSync } from "node:fs";
import mongoose from "mongoose";
import { loadConfig } from "@betterbasket/runtime";
import { productEnvSchema } from "../src/config";
import { lowestVariantPrice } from "../src/products/pricing";
import { ProductDocument, ProductSchema } from "../src/products/schemas/product.schema";

const envFile = `.env.${process.env.NODE_ENV ?? "development"}`;
if (existsSync(envFile)) process.loadEnvFile(envFile);
else if (existsSync(".env")) process.loadEnvFile(".env");
const config = loadConfig(productEnvSchema);

async function run() {
  const connection = await mongoose
    .createConnection(config.MONGODB_URI, { autoIndex: false })
    .asPromise();
  try {
    const collection = connection.collection("products");
    const cursor = collection.find(
      { minPrice: { $exists: false } },
      { projection: { _id: 1, basePrice: 1, variants: 1 } },
    );
    let migrated = 0;
    for await (const product of cursor) {
      const basePrice = product.basePrice as { amount: number };
      const variants = product.variants as { price: { amount: number } }[];
      const minPrice = lowestVariantPrice(basePrice, variants);
      const result = await collection.updateOne(
        { _id: product._id, minPrice: { $exists: false } },
        { $set: { minPrice } },
      );
      migrated += result.modifiedCount;
    }
    const model = connection.model(ProductDocument.name, ProductSchema);
    await model.createIndexes();
    process.stdout.write(`Product min-price migration complete: ${migrated} documents updated\n`);
  } finally {
    await connection.close();
  }
}

void run().catch(() => {
  // Driver and validation errors can contain connection details or document data.
  process.stderr.write(
    "Product min-price migration failed: check records and database connection\n",
  );
  process.exitCode = 1;
});

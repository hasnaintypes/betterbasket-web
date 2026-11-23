import { existsSync } from "node:fs";
import mongoose from "mongoose";
import { z } from "zod";
import { loadConfig } from "@betterbasket/runtime";
import { productEnvSchema } from "../src/config";
import { migrateProductV2, type LegacyProduct } from "../src/products/migration";
import { ProductDocument, ProductSchema } from "../src/products/schemas/product.schema";

const envFile = `.env.${process.env.NODE_ENV ?? "development"}`;
if (existsSync(envFile)) process.loadEnvFile(envFile);
else if (existsSync(".env")) process.loadEnvFile(".env");
const config = loadConfig(
  productEnvSchema.extend({ PRODUCT_LEGACY_SELLER_MAP: z.string().default("{}") }),
);

async function run() {
  let mapping: Record<string, string>;
  try {
    mapping = z
      .record(z.string(), z.uuid())
      .parse(JSON.parse(config.PRODUCT_LEGACY_SELLER_MAP) as unknown);
  } catch {
    throw new Error(
      "PRODUCT_LEGACY_SELLER_MAP must be a JSON object of organization IDs to seller UUIDs",
    );
  }
  const connection = await mongoose
    .createConnection(config.MONGODB_URI, { autoIndex: false })
    .asPromise();
  try {
    const collection = connection.collection("products");
    const cursor = collection.find({ schemaVersion: { $ne: 2 } });
    let migrated = 0;
    for await (const legacy of cursor) {
      const next = migrateProductV2(legacy as LegacyProduct, mapping);
      const result = await collection.updateOne(
        { _id: legacy._id, schemaVersion: { $ne: 2 } },
        { $set: next, $unset: { organizationId: "" } },
      );
      migrated += result.modifiedCount;
    }
    const model = connection.model(ProductDocument.name, ProductSchema);
    try {
      await model.createIndexes();
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        throw new Error("Duplicate seller SKU or product slug prevents v2 index creation", {
          cause: error,
        });
      }
      throw error;
    }
    process.stdout.write(`Product v2 migration complete: ${migrated} documents updated\n`);
  } finally {
    await connection.close();
  }
}

void run().catch((error: unknown) => {
  // Driver and validation errors can include data or connection details.
  const message =
    error instanceof Error && error.message.startsWith("Duplicate seller SKU")
      ? error.message
      : "check the seller map, legacy records, and database connection";
  process.stderr.write(`Product v2 migration failed: ${message}\n`);
  process.exitCode = 1;
});

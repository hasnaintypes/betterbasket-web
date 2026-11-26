import { createHash } from "node:crypto";
import { CreateProductInputSchema } from "@betterbasket/contracts";
import { categoryIds } from "./catalog";

export function assertSeedEnvironment(environment: string | undefined): void {
  if (environment !== "development" && environment !== "staging") {
    throw new Error("Synthetic product seeding requires NODE_ENV=development or staging");
  }
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type SeedStore = {
  updateOne: (
    filter: { slug: string },
    update: { $setOnInsert: Record<string, unknown> },
    options: { upsert: true },
  ) => Promise<unknown>;
};

export async function seedProducts(store: SeedStore, productCount: number, sellerCount: number) {
  if (!Number.isSafeInteger(productCount) || productCount < 1 || productCount > 10000)
    throw new Error("Product count must be between 1 and 10000");
  if (!Number.isSafeInteger(sellerCount) || sellerCount < 1 || sellerCount > productCount)
    throw new Error("Seller count must be between 1 and product count");

  for (let index = 0; index < productCount; index++) {
    const seller = index % sellerCount;
    const slug = `synthetic-v1-${seller}-${index}`;
    const input = CreateProductInputSchema.parse({
      title: `Synthetic Product ${index + 1}`,
      description: "Synthetic development catalog item",
      category: categoryIds[index % categoryIds.length],
      images: ["https://placehold.co/600x600?text=Synthetic"],
      basePrice: { amount: 1000 + index, currency: "USD" },
      variants: [
        {
          sku: `SYN-V1-${seller}-${index}`,
          options: {},
          price: { amount: 1000 + index, currency: "USD" },
          stock: 10,
        },
      ],
    });
    await store.updateOne(
      { slug },
      {
        $setOnInsert: {
          ...input,
          slug,
          sellerId: stableUuid(`synthetic-v1-seller-${seller}`),
          variants: input.variants.map((variant) => ({
            ...variant,
            variantId: stableUuid(`synthetic-v1-variant-${index}`),
          })),
          status: "draft",
          sellerStatus: "other",
          version: 0,
          schemaVersion: 2,
        },
      },
      { upsert: true },
    );
  }
}

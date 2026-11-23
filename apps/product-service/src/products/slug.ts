import { randomBytes } from "node:crypto";
import { slugify } from "@betterbasket/utils";

export function productSlug(title: string, suffix = randomBytes(3).toString("hex")) {
  const base = slugify(title).slice(0, 213).replace(/-$/, "") || "product";
  return `${base}-${suffix}`;
}

export function isSlugDuplicate(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const mongo = current as {
      code?: number;
      keyPattern?: Record<string, number>;
      cause?: unknown;
    };
    if (mongo.code === 11000 && mongo.keyPattern?.slug === 1) return true;
    current = mongo.cause;
  }
  return false;
}

export function isSellerSkuDuplicate(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const mongo = current as {
      code?: number;
      keyPattern?: Record<string, number>;
      cause?: unknown;
    };
    if (
      mongo.code === 11000 &&
      mongo.keyPattern?.sellerId === 1 &&
      mongo.keyPattern?.["variants.sku"] === 1
    )
      return true;
    current = mongo.cause;
  }
  return false;
}

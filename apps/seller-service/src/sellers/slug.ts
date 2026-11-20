import { randomBytes } from "node:crypto";
import { slugify } from "@betterbasket/utils";

const reserved = new Set([
  "admin",
  "api",
  "auth",
  "checkout",
  "help",
  "internal",
  "login",
  "logout",
  "new",
  "orders",
  "payments",
  "products",
  "seller",
  "sellers",
  "settings",
  "signup",
  "store",
  "stores",
  "support",
  "webhook",
  "webhooks",
  "www",
]);

export class InvalidSellerSlugError extends Error {}
export class SellerSlugCollisionError extends Error {}

export function sellerSlugBase(input: string): string {
  const normalized = slugify(input);
  if (normalized.length < 2 || reserved.has(normalized)) {
    throw new InvalidSellerSlugError("Invalid or reserved seller slug");
  }
  return normalized.slice(0, 91).replace(/-$/, "");
}

function isSlugConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const pg = current as { code?: string; constraint?: string; cause?: unknown };
    if (
      pg.code === "23505" &&
      ["sellers_slug_unique", "sellers_slug_key"].includes(pg.constraint ?? "")
    )
      return true;
    current = pg.cause;
  }
  return false;
}

/** Retry only a slug unique-index collision; other database failures propagate. */
export async function insertWithSellerSlug<T>(
  base: string,
  insert: (slug: string) => Promise<T>,
  suffix: () => string = () => randomBytes(4).toString("hex"),
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await insert(`${base}-${suffix()}`);
    } catch (error) {
      if (!isSlugConflict(error)) throw error;
    }
  }
  throw new SellerSlugCollisionError("Could not allocate a unique seller slug");
}

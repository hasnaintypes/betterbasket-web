import { BadRequestException } from "@nestjs/common";
import taxonomy from "./taxonomy.json";

export const categories = taxonomy;
export const categoryIds = taxonomy.categories.flatMap((parent) =>
  parent.children.map((child) => child.id),
);
const allowedCategories = new Set(categoryIds);

export function assertKnownCategory(category: string): void {
  if (!allowedCategories.has(category)) {
    throw new BadRequestException("Unknown product category");
  }
}

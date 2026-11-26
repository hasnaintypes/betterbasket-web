import Image from "next/image";
import React from "react";
import type { CatalogProduct } from "@/lib/catalog";
import { imageKitLoader, imageKitUrl } from "@/lib/imagekit-loader";

const price = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function ProductCard({ product }: { product: CatalogProduct }) {
  const image = product.images.find(imageKitUrl);
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="relative aspect-square overflow-hidden bg-muted">
        {image ? (
          <Image
            src={image}
            alt={product.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            loader={imageKitLoader}
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-foreground">
            Image unavailable
          </div>
        )}
      </div>
      <div className="space-y-2 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {product.category.replaceAll("-", " ")}
        </p>
        <h3 className="line-clamp-2 text-base font-semibold leading-snug">{product.title}</h3>
        <p className="text-base font-semibold">{price.format(product.minPrice / 100)}</p>
      </div>
    </article>
  );
}

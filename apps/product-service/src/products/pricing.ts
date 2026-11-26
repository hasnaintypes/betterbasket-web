export function lowestVariantPrice(
  basePrice: { amount: number },
  variants: readonly { price: { amount: number } }[],
): number {
  const prices = variants.length
    ? variants.map((variant) => variant.price.amount)
    : [basePrice.amount];
  if (prices.some((price) => !Number.isSafeInteger(price) || price < 0)) {
    throw new Error("Product price must be a nonnegative integer");
  }
  return Math.min(...prices);
}

export function imageKitUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname === "ik.imagekit.io";
  } catch {
    return false;
  }
}

export function imageKitLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  if (!imageKitUrl(src)) throw new Error("Product image must use ImageKit");
  const url = new URL(src);
  url.searchParams.set("tr", `w-${width},q-${quality ?? 80}`);
  return url.toString();
}

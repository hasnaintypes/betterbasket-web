/** @param {string | null | undefined} value */
export function safeReturnTo(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const parsed = new URL(value, "https://storefront.invalid");
    if (parsed.origin !== "https://storefront.invalid") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

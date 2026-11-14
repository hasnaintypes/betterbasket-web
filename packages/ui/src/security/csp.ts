export type AppSurface = "web" | "seller" | "admin";

/** Build the report-only policy from a fresh nonce and the configured gateway origin. */
export function cspPolicy(nonce: string, apiUrl: string | undefined, surface: AppSurface): string {
  let apiOrigin = "";
  let socketOrigin = "";
  if (apiUrl) {
    const url = new URL(apiUrl);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("NEXT_PUBLIC_API_URL must be an HTTP(S) origin");
    }
    apiOrigin = url.origin;
    socketOrigin = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  }
  const stripeScripts = surface === "web" ? " https://js.stripe.com" : "";
  const stripeFrames = surface === "web" ? " https://js.stripe.com https://hooks.stripe.com" : "";
  const imageKit = surface === "admin" ? "" : " https://ik.imagekit.io";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${stripeScripts}`,
    // Tailwind currently needs inline styles. Scripts never permit unsafe-inline.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${imageKit}`,
    "font-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin} ${socketOrigin}` : ""}${surface === "web" ? " https://api.stripe.com" : ""}`,
    `frame-src 'self'${stripeFrames}`,
    `frame-ancestors '${surface === "web" ? "self" : "none"}'`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

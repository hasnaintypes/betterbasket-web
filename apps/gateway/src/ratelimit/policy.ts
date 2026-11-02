export type RateLimitClass = "default" | "auth-mutations" | "webhooks" | "realtime-connect";

export const rateLimitPolicies: Readonly<
  Record<RateLimitClass, { limit: number; windowMs: number }>
> = {
  default: { limit: 120, windowMs: 60_000 },
  "auth-mutations": { limit: 20, windowMs: 60_000 },
  webhooks: { limit: 300, windowMs: 60_000 },
  "realtime-connect": { limit: 30, windowMs: 60_000 },
};

export function resolveRateLimitClass(
  method: string,
  url: string,
  upgrade = false,
): RateLimitClass {
  let path = url.split("?", 1)[0]?.toLowerCase() ?? "";
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    } catch {
      break;
    }
  }
  if (upgrade && (path === "/realtime" || path === "/realtime/")) return "realtime-connect";
  if (path === "/webhooks/stripe/account" || path === "/webhooks/stripe/connect") return "webhooks";
  if (
    method.toUpperCase() === "POST" &&
    /^\/api\/auth\/(?:sign-in|sign-up|reset-password|forget-password|forgot-password|request-password-reset)(?:\/|$)/.test(
      path,
    )
  )
    return "auth-mutations";
  return "default";
}

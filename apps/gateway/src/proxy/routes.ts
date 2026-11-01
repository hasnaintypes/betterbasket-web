import type { GatewayConfig } from "../config";

export interface GatewayRoute {
  prefix: string;
  target: keyof Pick<
    GatewayConfig,
    | "AUTH_SERVICE_URL"
    | "PRODUCT_SERVICE_URL"
    | "SELLER_SERVICE_URL"
    | "ORDER_SERVICE_URL"
    | "PAYMENT_SERVICE_URL"
    | "MEDIA_SERVICE_URL"
    | "ANALYTICS_SERVICE_URL"
  >;
  upstreamPrefix: string;
}

export const routes: readonly GatewayRoute[] = [
  { prefix: "/api/auth", target: "AUTH_SERVICE_URL", upstreamPrefix: "/api/auth" },
  { prefix: "/api/products", target: "PRODUCT_SERVICE_URL", upstreamPrefix: "/products" },
  { prefix: "/api/sellers", target: "SELLER_SERVICE_URL", upstreamPrefix: "/sellers" },
  { prefix: "/api/orders", target: "ORDER_SERVICE_URL", upstreamPrefix: "/orders" },
  { prefix: "/api/payments", target: "PAYMENT_SERVICE_URL", upstreamPrefix: "/payments" },
  { prefix: "/api/media", target: "MEDIA_SERVICE_URL", upstreamPrefix: "/media" },
  { prefix: "/api/analytics", target: "ANALYTICS_SERVICE_URL", upstreamPrefix: "/analytics" },
];

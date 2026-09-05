/**
 * Every downstream service gets a fixed URL via env var (Railway/Render
 * internal networking in prod, localhost ports in dev/docker-compose). This
 * is the "environment-variable based service registry" — no Consul/etcd.
 */
export const ServiceRegistry = {
  auth: process.env.AUTH_SERVICE_URL ?? "http://localhost:4001",
  product: process.env.PRODUCT_SERVICE_URL ?? "http://localhost:4002",
  seller: process.env.SELLER_SERVICE_URL ?? "http://localhost:4003",
  order: process.env.ORDER_SERVICE_URL ?? "http://localhost:4004",
  payment: process.env.PAYMENT_SERVICE_URL ?? "http://localhost:4005",
  notification: process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4006",
  media: process.env.MEDIA_SERVICE_URL ?? "http://localhost:4007",
  analytics: process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:4008",
} as const;

export type ServiceName = keyof typeof ServiceRegistry;

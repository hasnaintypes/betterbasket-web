import { z } from "zod";
import { bool, csv, port, url } from "@betterbasket/runtime";

export const gatewayEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]),
  PORT: port(),
  ENABLE_DOCS: bool().optional(),
  GIT_SHA: z.string().min(1).optional(),
  CORS_ALLOWED_ORIGINS: csv().pipe(z.array(url()).min(1)),
  AUTH_SERVICE_URL: url(),
  PRODUCT_SERVICE_URL: url(),
  SELLER_SERVICE_URL: url(),
  ORDER_SERVICE_URL: url(),
  PAYMENT_SERVICE_URL: url(),
  MEDIA_SERVICE_URL: url(),
  ANALYTICS_SERVICE_URL: url(),
});

export const gatewayTestSchema = gatewayEnvSchema.extend({ NODE_ENV: z.literal("test") });
export const GATEWAY_CONFIG = "GATEWAY_CONFIG";
export type GatewayConfig = Readonly<z.infer<typeof gatewayEnvSchema>>;

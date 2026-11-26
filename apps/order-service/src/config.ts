import { z } from "zod";
import { port, url } from "@betterbasket/runtime";

export const orderEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: port(),
  AUTH_ISSUER: url(),
  AUTH_AUDIENCE: url().optional(),
  AUTH_JWKS_URL: url(),
  DATABASE_URL: z.string().min(1),
  PRODUCT_SERVICE_URL: url(),
  PAYMENTS_ENABLED: z.enum(["true", "false"]).optional(),
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_USERNAME: z.string().min(1),
  KAFKA_PASSWORD: z.string().min(1),
  KAFKA_TOPIC_PREFIX: z.string(),
});

export function paymentsEnabled(): boolean {
  return (
    process.env.PAYMENTS_ENABLED === "true" ||
    (process.env.PAYMENTS_ENABLED === undefined && process.env.NODE_ENV === "test")
  );
}

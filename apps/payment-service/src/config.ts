import { z } from "zod";
import { port, secret, url } from "@betterbasket/runtime";

export const paymentEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: port(),
  AUTH_SERVICE_URL: url(),
  DATABASE_URL: z.string().min(1),
  STRIPE_SECRET_KEY: secret(),
  STRIPE_WEBHOOK_SECRET: secret(),
  PLATFORM_FEE_BPS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(10000)),
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_USERNAME: z.string().min(1),
  KAFKA_PASSWORD: z.string().min(1),
  KAFKA_TOPIC_PREFIX: z.string(),
});

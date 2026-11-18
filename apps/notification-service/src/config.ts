import { z } from "zod";
import { port, secret, url } from "@betterbasket/runtime";

export const notificationEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: port(),
  AUTH_ISSUER: url(),
  AUTH_AUDIENCE: url().optional(),
  AUTH_JWKS_URL: url(),
  KAFKA_BROKERS: z.string().min(1),
  RESEND_API_KEY: secret(),
  KAFKA_USERNAME: z.string().min(1),
  KAFKA_PASSWORD: z.string().min(1),
  KAFKA_TOPIC_PREFIX: z.string(),
});

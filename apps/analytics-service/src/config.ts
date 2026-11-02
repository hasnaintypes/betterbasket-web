import { z } from "zod";
import { port, url } from "@betterbasket/runtime";

export const analyticsEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: port(),
  AUTH_SERVICE_URL: url(),
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_USERNAME: z.string().min(1),
  KAFKA_PASSWORD: z.string().min(1),
  KAFKA_TOPIC_PREFIX: z.string(),
});

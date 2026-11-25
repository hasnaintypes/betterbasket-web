import { z } from "zod";
import { port, secret, url } from "@betterbasket/runtime";

export const sellerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: port(),
  AUTH_ISSUER: url(),
  AUTH_AUDIENCE: url().optional(),
  AUTH_JWKS_URL: url(),
  DATABASE_URL: z.string().min(1),
  STRIPE_SECRET_KEY: secret().refine((key) => key.startsWith("sk_test_"), {
    message: "Only Stripe test-mode keys are permitted",
  }),
  ALLOWED_FRONTEND_ORIGINS: z
    .string()
    .min(1)
    .superRefine((value, context) => {
      const origins = value.split(",").map((item) => item.trim());
      for (const origin of origins) {
        try {
          const parsed = new URL(origin);
          if (parsed.origin !== origin || !["https:", "http:"].includes(parsed.protocol)) {
            throw new Error("Invalid origin");
          }
        } catch {
          context.addIssue({ code: "custom", message: "Expected comma-separated URL origins" });
        }
      }
    }),
  SUPPORTED_SELLER_COUNTRIES: z.string().default(""),
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_USERNAME: z.string().min(1),
  KAFKA_PASSWORD: z.string().min(1),
  KAFKA_TOPIC_PREFIX: z.string(),
});

export type SellerConfig = z.output<typeof sellerEnvSchema>;

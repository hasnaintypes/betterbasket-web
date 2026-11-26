import { z } from "zod";
import { port, secret, url } from "@betterbasket/runtime";

const basePaymentEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: port(),
  AUTH_ISSUER: url(),
  AUTH_AUDIENCE: url().optional(),
  AUTH_JWKS_URL: url(),
  DATABASE_URL: z.string().min(1),
  STRIPE_SECRET_KEY: secret(),
  STRIPE_ACCOUNT_WEBHOOK_SECRET: secret(),
  STRIPE_CONNECT_WEBHOOK_SECRET: secret(),
  PAYMENTS_ENABLED: z.enum(["true", "false"]).optional(),
  PAYMENTS_LIVE_MODE_ENABLED: z.enum(["true", "false"]).default("false"),
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

export const paymentEnvSchema = basePaymentEnvSchema.superRefine((env, context) => {
  if (env.PAYMENTS_LIVE_MODE_ENABLED === "false" && env.STRIPE_SECRET_KEY.startsWith("sk_live_")) {
    context.addIssue({
      code: "custom",
      path: ["STRIPE_SECRET_KEY"],
      message: "Live Stripe key requires PAYMENTS_LIVE_MODE_ENABLED=true",
    });
  }
});

export type PaymentConfig = z.output<typeof paymentEnvSchema>;

export function paymentsEnabled(): boolean {
  return (
    process.env.PAYMENTS_ENABLED === "true" ||
    (process.env.PAYMENTS_ENABLED === undefined && process.env.NODE_ENV === "test")
  );
}

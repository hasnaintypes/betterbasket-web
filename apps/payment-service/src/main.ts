import "reflect-metadata";
import type { Type } from "@nestjs/common";
import { existsSync } from "node:fs";
import { bootstrapService, loadConfig } from "@betterbasket/runtime";
import { paymentEnvSchema } from "./config";

export async function bootstrap(overrideModule?: Type<unknown>) {
  const envFile = `.env.${process.env.NODE_ENV ?? "development"}`;
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  else if (existsSync(".env")) process.loadEnvFile(".env");
  const config = loadConfig(paymentEnvSchema);
  const AppModule = overrideModule ?? (await import("./app.module")).AppModule;
  return bootstrapService({
    module: AppModule,
    name: "payment-service",
    port: overrideModule ? 0 : config.PORT,
    options: {
      rawBody: true, // Preserve the raw Stripe webhook body for signature verification.
      swagger: {
        title: "BetterBasket Payment Service",
        description:
          "Stripe Connect payment intents, webhooks, seller payout ledger. Postgres-backed.",
        version: "0.1.0",
      },
    },
  });
}

if (require.main === module) void bootstrap();

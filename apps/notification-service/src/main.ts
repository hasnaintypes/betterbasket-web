import "reflect-metadata";
import type { Type } from "@nestjs/common";
import { existsSync } from "node:fs";
import { bootstrapService, loadConfig } from "@betterbasket/runtime";
import { notificationEnvSchema } from "./config";

export async function bootstrap(overrideModule?: Type<unknown>) {
  const envFile = `.env.${process.env.NODE_ENV ?? "development"}`;
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  else if (existsSync(".env")) process.loadEnvFile(".env");
  const config = loadConfig(notificationEnvSchema);
  const AppModule = overrideModule ?? (await import("./app.module")).AppModule;
  return bootstrapService({
    module: AppModule,
    name: "notification-service",
    port: overrideModule ? 0 : config.PORT,
    options: {
      swagger: {
        title: "BetterBasket Notification Service",
        description: "Kafka consumer that fans out to email/SMS/push providers.",
        version: "0.1.0",
      },
    },
  });
}

if (require.main === module) void bootstrap();

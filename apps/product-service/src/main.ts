import "reflect-metadata";
import type { Type } from "@nestjs/common";
import { existsSync } from "node:fs";
import { bootstrapService, loadConfig } from "@betterbasket/runtime";
import { productEnvSchema } from "./config";

export async function bootstrap(overrideModule?: Type<unknown>) {
  const envFile = `.env.${process.env.NODE_ENV ?? "development"}`;
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  else if (existsSync(".env")) process.loadEnvFile(".env");
  const config = loadConfig(productEnvSchema);
  const AppModule = overrideModule ?? (await import("./app.module")).AppModule;
  return bootstrapService({
    module: AppModule,
    name: "product-service",
    port: overrideModule ? 0 : config.PORT,
    options: {
      swagger: {
        title: "BetterBasket Product Service",
        description: "Product catalog & inventory. MongoDB-backed.",
        version: "0.1.0",
      },
    },
  });
}

if (require.main === module) void bootstrap();

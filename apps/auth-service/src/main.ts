import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { bootstrapService, loadConfig, port } from "@betterbasket/runtime";
import { z } from "zod";
import type { Express } from "express";
import { AppModule } from "./app.module";
import { createAuth } from "./auth/auth.config";

async function bootstrap() {
  await bootstrapService({
    module: AppModule,
    name: "auth-service",
    port: () => loadConfig(z.object({ PORT: port() })).PORT,
    options: {
      bodyParser: false, // Better Auth reads the raw request body itself.
      swagger: {
        title: "BetterBasket Auth Service",
        description:
          "Identity & RBAC via Better Auth (organization, admin, jwt/JWKS plugins). Postgres-backed. " +
          "Auth endpoints live under /api/auth/* and are not part of this Swagger doc " +
          "(see https://www.better-auth.com/docs for the full endpoint reference).",
        version: "0.1.0",
      },
      beforeInit: async (app) => {
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        // Keep the Better Auth handler ahead of Nest routes and retain its dynamic import.
        const auth = await createAuth();
        const { toNodeHandler } = await import("better-auth/node");
        const expressApp = app.getHttpAdapter().getInstance() as Express;
        expressApp.all(/^\/api\/auth(?:\/.*)?$/, toNodeHandler(auth));
      },
    },
  });
}

bootstrap();

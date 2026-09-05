import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { Express } from "express";
import { AppModule } from "./app.module";
import { createAuth } from "./auth/auth.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true,
    bodyParser: false, // required: Better Auth reads the raw request body itself
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // `better-auth` is ESM-only; this service is CommonJS, so both the auth
  // instance and its Express handler are loaded via dynamic import() (see
  // the comment in auth.config.ts for why).
  const auth = await createAuth();
  const { toNodeHandler } = await import("better-auth/node");
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.all("/api/auth/*", toNodeHandler(auth));

  const config = new DocumentBuilder()
    .setTitle("BetterBasket Auth Service")
    .setDescription(
      "Identity & RBAC via Better Auth (organization, admin, jwt/JWKS plugins). Postgres-backed. " +
        "Auth endpoints live under /api/auth/* and are not part of this Swagger doc " +
        "(see https://www.better-auth.com/docs for the full endpoint reference).",
    )
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  const port = process.env.PORT ?? 4001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[auth-service] listening on :${port} (docs at /docs, auth at /api/auth)`);
}

bootstrap();

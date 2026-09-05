import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true,
    bodyParser: false, // required: Better Auth reads the raw request body itself
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

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

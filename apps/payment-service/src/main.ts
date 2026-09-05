import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true,
    rawBody: true, // required: exposes req.rawBody for Stripe webhook signature verification
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle("BetterBasket Payment Service")
    .setDescription("Stripe Connect payment intents, webhooks, seller payout ledger. Postgres-backed.")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  const port = process.env.PORT ?? 4005;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[payment-service] listening on :${port} (docs at /docs)`);
}

bootstrap();

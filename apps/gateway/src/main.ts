import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { registerProxies } from "./proxy/register-proxies";
import { GATEWAY_CONFIG, type GatewayConfig } from "./config";
import { ServiceRegistry } from "./proxy/service-registry";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const runtimeConfig = app.get<GatewayConfig>(GATEWAY_CONFIG);
  app.enableCors({ origin: runtimeConfig.CORS_ALLOWED_ORIGINS });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle("BetterBasket API Gateway")
    .setDescription(
      "Single entry point for web/seller-portal/admin-portal. Routes /api/<service>/** " +
        "to the matching downstream service. Each service publishes its own OpenAPI spec " +
        "at <service>/docs.",
    )
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  // Proxy routes must be registered after Nest's own routes/middleware.
  registerProxies(app, app.get(ServiceRegistry));

  const port = runtimeConfig.PORT;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[gateway] listening on :${port} (docs at /docs)`);
}

bootstrap();

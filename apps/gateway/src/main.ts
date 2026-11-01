import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { bootstrapService } from "@betterbasket/runtime";
import { AppModule } from "./app.module";
import { registerProxies } from "./proxy/register-proxies";
import { GATEWAY_CONFIG, type GatewayConfig } from "./config";
import { ServiceRegistry } from "./proxy/service-registry";

async function bootstrap() {
  await bootstrapService({
    module: AppModule,
    name: "gateway",
    port: (app) => app.get<GatewayConfig>(GATEWAY_CONFIG).PORT,
    options: {
      swagger: {
        title: "BetterBasket API Gateway",
        description:
          "Single entry point for web/seller-portal/admin-portal. Routes /api/<service>/** " +
          "to the matching downstream service. Each service publishes its own OpenAPI spec " +
          "at <service>/docs.",
        version: "0.1.0",
      },
      beforeInit: (app) => {
        const config = app.get<GatewayConfig>(GATEWAY_CONFIG);
        app.enableCors({ origin: config.CORS_ALLOWED_ORIGINS });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        registerProxies(app, app.get(ServiceRegistry));
      },
    },
  });
}

bootstrap();

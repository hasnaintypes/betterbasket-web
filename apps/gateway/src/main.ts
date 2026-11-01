import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { bootstrapService } from "@betterbasket/runtime";
import { AppModule } from "./app.module";
import { registerProxies } from "./proxy/register-proxies";
import { GATEWAY_CONFIG, type GatewayConfig } from "./config";
import { configureCors, registerSecurityHeaders } from "./cors";
import { registerWebhooks } from "./proxy/webhooks";
import { registerBlockedPaths } from "./proxy/blocked";
import { registerWebSocketUpgrades } from "./proxy/register-proxies";

async function bootstrap() {
  const app = await bootstrapService({
    module: AppModule,
    name: "gateway",
    port: (app) => app.get<GatewayConfig>(GATEWAY_CONFIG).PORT,
    options: {
      bodyParser: false,
      beforeRoutes: (app) => {
        registerSecurityHeaders(app);
        configureCors(app, app.get<GatewayConfig>(GATEWAY_CONFIG));
      },
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
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        registerBlockedPaths(app);
        registerWebhooks(app, config);
        registerProxies(app, config);
      },
    },
  });
  registerWebSocketUpgrades(app.getHttpServer(), app.get<GatewayConfig>(GATEWAY_CONFIG));
}

bootstrap();

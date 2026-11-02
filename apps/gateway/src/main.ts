import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { bootstrapService } from "@betterbasket/runtime";
import { createLogger } from "@betterbasket/logger";
import { AppModule } from "./app.module";
import { registerProxies } from "./proxy/register-proxies";
import { GATEWAY_CONFIG, type GatewayConfig } from "./config";
import { configureCors, registerSecurityHeaders } from "./cors";
import { registerWebhooks } from "./proxy/webhooks";
import { registerBlockedPaths } from "./proxy/blocked";
import { registerWebSocketUpgrades } from "./proxy/register-proxies";
import { InMemoryRateLimitStore } from "./ratelimit/store";
import { RateLimiter } from "./ratelimit/limiter";
import { registerRateLimiting } from "./ratelimit/http";

async function bootstrap() {
  const rateLimitLogger = createLogger({ service: "gateway" });
  const limiter = new RateLimiter(new InMemoryRateLimitStore(), Date.now, (total) =>
    rateLimitLogger.warn(
      { rateLimitStoreFailuresTotal: total },
      "rate-limit store unavailable; request allowed",
    ),
  );
  const app = await bootstrapService({
    module: AppModule,
    name: "gateway",
    port: (app) => app.get<GatewayConfig>(GATEWAY_CONFIG).PORT,
    options: {
      bodyParser: false,
      beforeRoutes: (app) => {
        const config = app.get<GatewayConfig>(GATEWAY_CONFIG);
        registerSecurityHeaders(app);
        registerBlockedPaths(app);
        configureCors(app, config);
        registerRateLimiting(app, config, limiter);
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
        registerWebhooks(app, config);
        registerProxies(app, config);
      },
    },
  });
  const config = app.get<GatewayConfig>(GATEWAY_CONFIG);
  registerWebSocketUpgrades(app.getHttpServer(), config, limiter);
}

bootstrap();

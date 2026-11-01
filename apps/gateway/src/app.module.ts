import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { loadConfig } from "@betterbasket/runtime";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { GATEWAY_CONFIG, gatewayEnvSchema, gatewayTestSchema } from "./config";
import { ServiceRegistry } from "./proxy/service-registry";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV}`, ".env"],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ServiceRegistry,
    {
      provide: GATEWAY_CONFIG,
      useFactory: () =>
        loadConfig(process.env.NODE_ENV === "test" ? gatewayTestSchema : gatewayEnvSchema),
    },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}

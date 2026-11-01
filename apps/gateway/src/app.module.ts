import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { loadConfig } from "@betterbasket/runtime";
import { GATEWAY_CONFIG, gatewayEnvSchema, gatewayTestSchema } from "./config";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV}`, ".env"],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  providers: [
    {
      provide: GATEWAY_CONFIG,
      useFactory: () =>
        loadConfig(process.env.NODE_ENV === "test" ? gatewayTestSchema : gatewayEnvSchema),
    },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}

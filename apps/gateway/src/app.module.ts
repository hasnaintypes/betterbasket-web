import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { loadConfig } from "@betterbasket/runtime";
import { GATEWAY_CONFIG, gatewayEnvSchema, gatewayTestSchema } from "./config";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV}`, ".env"],
    }),
  ],
  providers: [
    {
      provide: GATEWAY_CONFIG,
      useFactory: () =>
        loadConfig(process.env.NODE_ENV === "test" ? gatewayTestSchema : gatewayEnvSchema),
    },
  ],
})
export class AppModule {}

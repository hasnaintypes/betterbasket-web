import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { NotificationsModule } from "./notifications/notifications.module";

@Module({
  imports: [ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? "development"}`, ".env"],
    }), NotificationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

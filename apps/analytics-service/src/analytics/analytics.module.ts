import { Module } from "@nestjs/common";
import { AnalyticsGateway } from "./analytics.gateway";
import { AnalyticsConsumerService } from "./analytics-consumer.service";

@Module({
  providers: [AnalyticsGateway, AnalyticsConsumerService],
})
export class AnalyticsModule {}

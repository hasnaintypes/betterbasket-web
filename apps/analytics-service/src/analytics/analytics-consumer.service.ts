import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createKafkaClientFromEnv, runConsumer } from "@betterbasket/kafka-client";
import { Topics } from "@betterbasket/contracts";
import { createLogger } from "@betterbasket/logger";
import { AnalyticsGateway } from "./analytics.gateway";

@Injectable()
export class AnalyticsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger({ service: "analytics-service" });
  private readonly kafka = createKafkaClientFromEnv("analytics-service");

  constructor(private readonly gateway: AnalyticsGateway) {}

  async onModuleInit() {
    await this.kafka.connectProducer();

    const orderConsumer = this.kafka.createConsumer("analytics-service-orders");
    await orderConsumer.connect();
    void runConsumer({
      consumer: orderConsumer,
      topic: Topics.OrderCreated,
      logger: this.logger,
      dlqProducer: this.kafka.producer,
      onMessage: async (payload) => {
        for (const sellerId of payload.sellerIds) {
          this.gateway.emitToOrganization(sellerId, "order.created", payload);
        }
        this.gateway.emitToPlatform("order.created", payload);
      },
    });

    const paymentConsumer = this.kafka.createConsumer("analytics-service-payments");
    await paymentConsumer.connect();
    void runConsumer({
      consumer: paymentConsumer,
      topic: Topics.PaymentSucceeded,
      logger: this.logger,
      dlqProducer: this.kafka.producer,
      onMessage: async (payload) => {
        this.gateway.emitToPlatform("payment.succeeded", payload);
      },
    });
  }

  async onModuleDestroy() {
    await this.kafka.disconnectAll();
  }
}

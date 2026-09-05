import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createKafkaClientFromEnv, runConsumer } from "@betterbasket/kafka-client";
import { Topics } from "@betterbasket/contracts";
import { createLogger } from "@betterbasket/logger";

@Injectable()
export class NotificationConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger({ service: "notification-service" });
  private readonly kafka = createKafkaClientFromEnv("notification-service");

  async onModuleInit() {
    await this.kafka.connectProducer();
    const consumer = this.kafka.createConsumer("notification-service");
    await consumer.connect();

    void runConsumer({
      consumer,
      topic: Topics.NotificationRequested,
      logger: this.logger,
      dlqProducer: this.kafka.producer,
      onMessage: async (payload) => {
        // TODO(Tier 3): dispatch to Resend (email), Twilio (SMS), or a push
        // provider based on `payload.channel`, rendering `payload.template`
        // with `payload.data`.
        this.logger.info(
          `notification requested: user=${payload.userId} channel=${payload.channel} template=${payload.template}`,
        );
      },
    });
  }

  async onModuleDestroy() {
    await this.kafka.disconnectAll();
  }
}

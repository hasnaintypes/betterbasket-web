import { Kafka, logLevel, type Producer, type Consumer } from "kafkajs";

export interface KafkaClientOptions {
  clientId: string;
  /** Comma-separated list — a Redpanda Cloud Serverless bootstrap server in every environment (no local broker). */
  brokers: string[];
  /** SASL creds for Redpanda Cloud. Omit only for a self-hosted broker with no auth. */
  sasl?: { username: string; password: string; mechanism?: "scram-sha-256" | "scram-sha-512" };
  ssl?: boolean;
}

/**
 * Thin wrapper around KafkaJS pointed at Redpanda Cloud Serverless
 * (Kafka-API compatible). There is no local/dev broker to run — dev and prod
 * both point at real (separate) Redpanda Cloud clusters via env vars, see
 * `.env.development.example` / `.env.production.example` in each service.
 * One instance per service; call `connectProducer()` during app bootstrap
 * and `disconnectAll()` on shutdown (see each service's main.ts).
 */
export class KafkaClient {
  readonly kafka: Kafka;
  readonly producer: Producer;
  private readonly consumers: Consumer[] = [];

  constructor(options: KafkaClientOptions) {
    this.kafka = new Kafka({
      clientId: options.clientId,
      brokers: options.brokers,
      ssl: options.ssl ?? true,
      sasl: options.sasl
        ? {
            mechanism: options.sasl.mechanism ?? "scram-sha-256",
            username: options.sasl.username,
            password: options.sasl.password,
          }
        : undefined,
      logLevel: logLevel.WARN,
      retry: { retries: 8, initialRetryTime: 300 },
    });
    this.producer = this.kafka.producer({ allowAutoTopicCreation: true });
  }

  async connectProducer() {
    await this.producer.connect();
  }

  createConsumer(groupId: string): Consumer {
    const consumer = this.kafka.consumer({ groupId });
    this.consumers.push(consumer);
    return consumer;
  }

  async disconnectAll() {
    await this.producer.disconnect().catch(() => undefined);
    await Promise.all(this.consumers.map((c) => c.disconnect().catch(() => undefined)));
  }
}

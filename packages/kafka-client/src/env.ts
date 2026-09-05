import { KafkaClient } from "./client";

/**
 * Builds a KafkaClient from standard env vars, pointed at Redpanda Cloud
 * Serverless. Every environment (dev, staging, prod) is a *different*
 * cluster with its own credentials — there's no shared/local broker.
 */
export function createKafkaClientFromEnv(clientId: string): KafkaClient {
  const brokers = (process.env.KAFKA_BROKERS ?? "").split(",").filter(Boolean);
  if (brokers.length === 0) {
    throw new Error(
      "KAFKA_BROKERS is not set — copy the bootstrap server from your Redpanda Cloud cluster " +
        "into .env.development / .env.production (see docs/infra-setup.md).",
    );
  }

  const username = process.env.KAFKA_USERNAME;
  const password = process.env.KAFKA_PASSWORD;

  return new KafkaClient({
    clientId,
    brokers,
    ssl: process.env.KAFKA_SSL !== "false",
    sasl: username && password ? { username, password } : undefined,
  });
}

/**
 * Namespaces a topic name per environment, e.g. "dev.order.created.v1" vs
 * "order.created.v1" in prod — lets dev/staging/prod safely share one
 * Redpanda Cloud cluster (free tier) via topic prefixing instead of needing
 * a separate cluster per environment. Set KAFKA_TOPIC_PREFIX="" in prod.
 */
export function prefixedTopic(topic: string): string {
  const prefix = process.env.KAFKA_TOPIC_PREFIX ?? "";
  return prefix ? `${prefix}${topic}` : topic;
}

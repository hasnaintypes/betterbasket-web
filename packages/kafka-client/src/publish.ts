import { randomUUID } from "node:crypto";
import type { Producer } from "kafkajs";
import { EventSchemaByTopic, type TopicName } from "@betterbasket/contracts";
import { prefixedTopic } from "./env.js";

/**
 * Publishes a validated event envelope to `topic`. Throws if `payload` doesn't
 * match the topic's Zod schema in `@betterbasket/contracts` — fail fast at the
 * producer instead of poisoning the topic for every consumer.
 */
export async function publishEvent<T extends TopicName>(
  producer: Producer,
  producerName: string,
  topic: T,
  payload: unknown,
): Promise<void> {
  const schema = EventSchemaByTopic[topic];
  const envelope = schema.parse({
    id: randomUUID(),
    occurredAt: new Date(),
    producer: producerName,
    payload,
  });

  await producer.send({
    topic: prefixedTopic(topic),
    messages: [{ key: envelope.id, value: JSON.stringify(envelope) }],
  });
}

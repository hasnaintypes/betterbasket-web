import type { Consumer, Producer } from "kafkajs";
import { EventSchemaByTopic, type TopicName } from "@betterbasket/contracts";
import type { Logger } from "@betterbasket/logger";
import { prefixedTopic } from "./env";

export interface RunConsumerOptions<T extends TopicName> {
  consumer: Consumer;
  topic: T;
  /** Handler receives the *validated* payload (schema.parse'd), not the raw envelope. */
  onMessage: (payload: ReturnType<(typeof EventSchemaByTopic)[T]["parse"]>["payload"]) => Promise<void>;
  logger: Logger;
  /** Max in-process retries before publishing to `<topic>.dlq`. Default 3. */
  maxRetries?: number;
  /** Producer used to forward poison messages to the dead-letter topic. */
  dlqProducer?: Producer;
}

/**
 * Subscribes to `topic` and processes messages one at a time with bounded
 * retries. On repeated failure, forwards the raw message to `<topic>.dlq`
 * (if `dlqProducer` is given) instead of blocking the partition forever.
 */
export async function runConsumer<T extends TopicName>({
  consumer,
  topic,
  onMessage,
  logger,
  maxRetries = 3,
  dlqProducer,
}: RunConsumerOptions<T>): Promise<void> {
  const schema = EventSchemaByTopic[topic];
  const resolvedTopic = prefixedTopic(topic);
  await consumer.subscribe({ topic: resolvedTopic, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const raw = message.value?.toString() ?? "{}";

      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          const envelope = schema.parse(JSON.parse(raw));
          await onMessage(envelope.payload as never);
          return;
        } catch (error) {
          logger.warn({ topic: resolvedTopic, attempt, error }, "kafka message processing failed");
          if (attempt === maxRetries) {
            if (dlqProducer) {
              await dlqProducer.send({ topic: `${resolvedTopic}.dlq`, messages: [{ value: raw }] });
              logger.error({ topic: resolvedTopic }, "message sent to DLQ after exhausting retries");
            } else {
              logger.error(
                { topic: resolvedTopic },
                "message dropped after exhausting retries (no DLQ configured)",
              );
            }
          } else {
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          }
        }
      }
    },
  });
}

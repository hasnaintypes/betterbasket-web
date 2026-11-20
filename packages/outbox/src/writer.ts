import { EventSchemaByTopic, type TopicName } from "@betterbasket/contracts";
import { sql, type SQL } from "drizzle-orm";

export interface TransactionExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** The caller owns commit/rollback; this method never opens its own transaction. */
export class OutboxWriter {
  static async add(tx: TransactionExecutor, event: unknown): Promise<void> {
    if (!event || typeof event !== "object") throw new Error("Invalid outbox event");
    const candidate = event as { type?: string; version?: number };
    const topic = `${candidate.type}.v${candidate.version}` as TopicName;
    const schema = EventSchemaByTopic[topic];
    if (!schema) throw new Error("Unknown outbox topic");
    const parsed = schema.parse(event);
    const encoded = JSON.stringify(parsed);
    if (Buffer.byteLength(encoded, "utf8") > 256 * 1024)
      throw new Error("Outbox event exceeds 256 KB");
    const { payload, ...headers } = parsed;
    await tx.execute(sql`insert into outbox
      (id, aggregate_type, aggregate_id, type, version, payload, headers, created_at)
      values (${parsed.id}, ${parsed.aggregateType}, ${parsed.aggregateId}, ${parsed.type},
        ${parsed.version}, ${JSON.stringify(payload)}::jsonb, ${JSON.stringify(headers)}::jsonb, clock_timestamp())`);
  }
}

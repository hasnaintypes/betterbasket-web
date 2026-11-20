import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

export interface OutboxMessage {
  topic: string;
  key: string;
  value: string;
}
export type Publish = (message: OutboxMessage) => Promise<void>;

interface OutboxRow {
  id: string;
  aggregate_id: string;
  type: string;
  version: number;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  attempts: number;
}

export interface RelayOptions {
  prefix?: string;
  onQuarantine?: (id: string) => void;
  onError?: (error: unknown) => void;
}

/** A publish promise must resolve only after the broker's acks=all acknowledgement. */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private running = false;
  private loopPromise?: Promise<void>;
  private wake?: () => void;
  private lastPurge = 0;

  constructor(
    private readonly pool: Pool,
    private readonly publish: Publish,
    private readonly options: RelayOptions = {},
  ) {}

  onModuleInit(): void {
    this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.runBatch();
        if (Date.now() - this.lastPurge > 3_600_000) {
          await this.purgePublished();
          this.lastPurge = Date.now();
        }
      } catch (error) {
        this.options.onError?.(error);
      }
      if (this.running) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 500);
          this.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.wake = undefined;
      }
    }
  }

  /** Locks at most one due row per aggregate while publishing and marking it. */
  async runBatch(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<OutboxRow>(`
        SELECT o.id, o.aggregate_id, o.type, o.version, o.payload, o.headers, o.attempts
        FROM outbox o
        WHERE o.published_at IS NULL AND o.quarantined_at IS NULL
          AND o.next_attempt_at <= now()
          AND NOT EXISTS (
            SELECT 1 FROM outbox older
            WHERE older.aggregate_type = o.aggregate_type
              AND older.aggregate_id = o.aggregate_id
              AND older.published_at IS NULL AND older.quarantined_at IS NULL
              AND (older.created_at, older.id) < (o.created_at, o.id)
          )
        ORDER BY o.aggregate_id, o.created_at, o.id
        LIMIT 50 FOR UPDATE OF o SKIP LOCKED`);
      for (const row of result.rows) await this.publishRow(client, row);
      await client.query("COMMIT");
      return result.rows.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async publishRow(client: PoolClient, row: OutboxRow): Promise<void> {
    const topic = `${this.options.prefix ?? ""}${row.type}.v${row.version}`;
    try {
      await this.publish({
        topic,
        key: row.aggregate_id,
        value: JSON.stringify({ ...row.headers, payload: row.payload }),
      });
      await client.query("UPDATE outbox SET published_at = now() WHERE id = $1", [row.id]);
    } catch {
      const attempts = row.attempts + 1;
      const delay = Math.min(3600, 2 ** Math.min(attempts, 12));
      await client.query(
        `UPDATE outbox SET attempts = $2,
        next_attempt_at = now() + ($3 * interval '1 second'),
        quarantined_at = CASE WHEN $2 >= 20 THEN now() ELSE NULL END
        WHERE id = $1`,
        [row.id, attempts, delay],
      );
      if (attempts >= 20) this.options.onQuarantine?.(row.id);
    }
  }

  async oldestUnpublishedAgeSeconds(): Promise<number | null> {
    const result = await this.pool.query<{ age: string | null }>(`
      SELECT EXTRACT(EPOCH FROM now() - min(created_at))::text AS age
      FROM outbox WHERE published_at IS NULL AND quarantined_at IS NULL`);
    return result.rows[0]?.age == null ? null : Number(result.rows[0].age);
  }

  async purgePublished(): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM outbox WHERE published_at < now() - interval '7 days'",
    );
    return result.rowCount ?? 0;
  }
}

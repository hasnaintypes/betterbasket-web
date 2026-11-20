import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";

export interface InboxTransaction {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

export interface InboxDatabase {
  transaction<T>(handler: (tx: InboxTransaction) => Promise<T>): Promise<T>;
}

export interface InboxKey {
  /** Use the full <env>.<service>.<purpose> consumer group name. */
  consumer: string;
  eventId: string;
}

export type InboxResult<T> = { processed: true; value: T } | { processed: false };

/** The claim and all handler effects commit or roll back as one transaction. */
export class Inbox {
  constructor(private readonly db: InboxDatabase) {}

  async run<T>(
    key: InboxKey,
    handler: (tx: InboxTransaction) => Promise<T>,
  ): Promise<InboxResult<T>> {
    if (!/^[^.]+\.[^.]+\.[^.]+$/.test(key.consumer))
      throw new Error("Consumer must be <env>.<service>.<purpose>");
    return this.db.transaction(async (tx) => {
      const claim = await tx.execute(sql`
        INSERT INTO processed_events (consumer, event_id)
        VALUES (${key.consumer}, ${key.eventId})
        ON CONFLICT (consumer, event_id) DO NOTHING
        RETURNING event_id`);
      if (claim.rows.length === 0) return { processed: false } as const;
      return { processed: true, value: await handler(tx) } as const;
    });
  }
}

/** Call from a service-owned scheduler; safe to run from multiple instances. */
export async function purgeProcessedEvents(db: Pick<InboxTransaction, "execute">): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM processed_events
    WHERE processed_at < now() - interval '14 days'
    RETURNING event_id`);
  return result.rows.length;
}

/** Runs retention at startup and hourly while the Nest module is active. */
@Injectable()
export class InboxRetention implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;

  constructor(
    private readonly db: Pick<InboxTransaction, "execute">,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  onModuleInit(): void {
    if (this.timer) return;
    this.run();
    this.timer = setInterval(() => this.run(), 3_600_000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.pending;
  }

  private run(): void {
    if (this.pending) return;
    this.pending = purgeProcessedEvents(this.db)
      .then(() => undefined)
      .catch((error: unknown) => this.onError(error))
      .finally(() => {
        this.pending = undefined;
      });
  }
}

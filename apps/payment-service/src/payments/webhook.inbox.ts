import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type Stripe from "stripe";
import { StripeProvider, type StripeWebhookScope } from "./stripe.provider";

export interface StripeEventProcessor {
  scope: StripeWebhookScope;
  type: string;
  /** Write effects and outbox rows through this client before the transaction commits. */
  process(event: Stripe.Event, client: PoolClient): Promise<void>;
}

export class StripeProcessorRegistry {
  private readonly processors: StripeEventProcessor[] = [];

  register(processor: StripeEventProcessor): void {
    if (
      this.processors.some((item) => item.scope === processor.scope && item.type === processor.type)
    ) {
      throw new Error("Stripe event processor already registered");
    }
    this.processors.push(processor);
  }

  find(scope: StripeWebhookScope, type: string): StripeEventProcessor | undefined {
    return this.processors.find((item) => item.scope === scope && item.type === type);
  }
}

interface StoredEvent {
  payload: Stripe.Event;
  scope: StripeWebhookScope;
  type: string;
  status: string;
}

/** Verified events are stored before dispatch. Processing and its effects share one transaction. */
export class StripeWebhookInbox implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StripeWebhookInbox.name);
  private retryTimer?: ReturnType<typeof setInterval>;
  private purgeTimer?: ReturnType<typeof setInterval>;
  private retryPromise?: Promise<void>;
  private purgePromise?: Promise<void>;

  constructor(
    private readonly provider: StripeProvider,
    private readonly registry: StripeProcessorRegistry,
    private readonly pool: Pool,
  ) {}

  async receive(
    rawBody: Buffer,
    signature: string,
    scope: StripeWebhookScope,
  ): Promise<{ received: true }> {
    let event: Stripe.Event;
    try {
      event = this.provider.verify(rawBody, signature, scope);
    } catch {
      throw new BadRequestException("Invalid Stripe signature");
    }

    try {
      const inserted = await this.pool.query(
        `INSERT INTO stripe_events (event_id, scope, type, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.id, scope, event.type, JSON.stringify(event)],
      );
      if (!inserted.rowCount) return { received: true };
      await this.processStored(event.id);
      return { received: true };
    } catch {
      throw new InternalServerErrorException("Webhook processing failed");
    }
  }

  async processStored(eventId: string): Promise<void> {
    const client = await this.pool.connect();
    let claimed = false;
    try {
      await client.query("BEGIN");
      const result = await client.query<StoredEvent>(
        `SELECT payload, scope, type, status FROM stripe_events
         WHERE event_id = $1 FOR UPDATE`,
        [eventId],
      );
      const row = result.rows[0];
      if (!row || row.status === "processed") {
        await client.query("COMMIT");
        return;
      }
      claimed = true;
      const processor = this.registry.find(row.scope, row.type);
      if (processor) await processor.process(row.payload, client);
      await client.query(
        "UPDATE stripe_events SET status = 'processed', processed_at = now() WHERE event_id = $1",
        [eventId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (claimed) {
        await this.pool.query(
          "UPDATE stripe_events SET status = 'failed' WHERE event_id = $1 AND status <> 'processed'",
          [eventId],
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Also retries received rows left by a crash after insertion. */
  async retryPending(): Promise<number> {
    const result = await this.pool.query<{ event_id: string }>(
      `SELECT event_id FROM stripe_events WHERE status IN ('received', 'failed')
       ORDER BY received_at, event_id LIMIT 50`,
    );
    for (const row of result.rows) {
      try {
        await this.processStored(row.event_id);
      } catch {
        this.logger.warn("Stripe event retry failed");
      }
    }
    return result.rows.length;
  }

  /** Keep failed events for recovery; remove processed payloads after 90 days. */
  async purgeProcessed(): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM stripe_events WHERE status = 'processed' AND processed_at < now() - interval '90 days'",
    );
    return result.rowCount ?? 0;
  }

  onModuleInit(): void {
    this.retryTimer = setInterval(() => {
      if (this.retryPromise) return;
      this.retryPromise = this.retryPending()
        .then(() => undefined)
        .catch(() => this.logger.warn("Stripe event retry scan failed"))
        .finally(() => {
          this.retryPromise = undefined;
        });
    }, 30_000);
    this.purgeTimer = setInterval(() => {
      if (this.purgePromise) return;
      this.purgePromise = this.purgeProcessed()
        .then(() => undefined)
        .catch(() => this.logger.warn("Stripe event retention failed"))
        .finally(() => {
          this.purgePromise = undefined;
        });
    }, 86_400_000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    await Promise.all([this.retryPromise, this.purgePromise]);
  }
}

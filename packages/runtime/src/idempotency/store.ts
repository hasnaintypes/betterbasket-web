import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

export const IDEMPOTENCY_POOL = "IDEMPOTENCY_POOL";
const leaseSeconds = 30;
const retentionHours = 24;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StoredResponse {
  hasBody: boolean;
  body: unknown;
  requestId: string | null;
}

export interface IdempotentResponse<T = unknown> {
  status: number;
  body: T;
  requestId?: string;
}

export interface IdempotencyResult<T = unknown> extends IdempotentResponse<T> {
  replayed: boolean;
}

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super("Idempotency key was already used with a different request body");
  }
}

export class RequestInProgressError extends Error {
  constructor() {
    super("A request with this idempotency key is in progress");
  }
}

type ExistingRow = {
  request_hash: string;
  status: number | null;
  response: StoredResponse | null;
  valid: boolean;
  active: boolean;
};

@Injectable()
export class IdempotencyStore {
  constructor(@Inject(IDEMPOTENCY_POOL) private readonly pool: Pool) {}

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: () => Promise<IdempotentResponse<T>>,
  ): Promise<IdempotencyResult<T>> {
    if (!scope || !uuidPattern.test(key) || !/^[0-9a-f]{64}$/.test(requestHash))
      throw new Error("Invalid idempotency scope, key, or request hash");
    const ownerId = randomUUID();
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.readExisting(scope, key);
      const early = this.resolveExisting<T>(current, requestHash);
      if (early) return early;
      const claimed = await this.claim(scope, key, requestHash, ownerId);
      if (claimed) return this.runClaimed(scope, key, ownerId, handler);
      const afterRace = this.resolveExisting<T>(await this.readExisting(scope, key), requestHash);
      if (afterRace) return afterRace;
    }
    throw new RequestInProgressError();
  }

  private async readExisting(scope: string, key: string): Promise<ExistingRow | undefined> {
    const result = await this.pool.query<ExistingRow>(
      `SELECT request_hash, status, response,
        expires_at > clock_timestamp() AS valid,
        in_progress_until > clock_timestamp() AS active
       FROM idempotency_keys WHERE scope = $1 AND key = $2`,
      [scope, key],
    );
    return result.rows[0];
  }

  private resolveExisting<T>(
    row: ExistingRow | undefined,
    requestHash: string,
  ): IdempotencyResult<T> | undefined {
    if (!row?.valid) return undefined;
    if (row.request_hash !== requestHash) throw new IdempotencyKeyReusedError();
    if (row.status !== null && row.response) {
      return {
        status: row.status,
        body: (row.response.hasBody ? row.response.body : undefined) as T,
        ...(row.response.requestId ? { requestId: row.response.requestId } : {}),
        replayed: true,
      };
    }
    if (row.active) throw new RequestInProgressError();
    return undefined;
  }

  private async claim(
    scope: string,
    key: string,
    requestHash: string,
    ownerId: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '30s'");
      const result = await client.query(
        `INSERT INTO idempotency_keys
          (scope, key, request_hash, created_at, expires_at, in_progress_until, owner_id)
         VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp() + interval '${retentionHours} hours',
           clock_timestamp() + interval '${leaseSeconds} seconds', $4)
         ON CONFLICT (scope, key) DO UPDATE SET
           request_hash = EXCLUDED.request_hash,
           status = NULL,
           response = NULL,
           created_at = clock_timestamp(),
           expires_at = clock_timestamp() + interval '${retentionHours} hours',
           in_progress_until = clock_timestamp() + interval '${leaseSeconds} seconds',
           owner_id = EXCLUDED.owner_id
         WHERE idempotency_keys.expires_at <= clock_timestamp()
           OR (idempotency_keys.status IS NULL
             AND idempotency_keys.request_hash = EXCLUDED.request_hash
             AND idempotency_keys.in_progress_until <= clock_timestamp())
         RETURNING owner_id`,
        [scope, key, requestHash, ownerId],
      );
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "55P03") throw new RequestInProgressError();
      throw error;
    } finally {
      client.release();
    }
  }

  private async runClaimed<T>(
    scope: string,
    key: string,
    ownerId: string,
    handler: () => Promise<IdempotentResponse<T>>,
  ): Promise<IdempotencyResult<T>> {
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query("SET LOCAL lock_timeout = '30s'");
      const row = await client.query<{ owner_id: string | null }>(
        `SELECT owner_id FROM idempotency_keys WHERE scope = $1 AND key = $2 FOR UPDATE`,
        [scope, key],
      );
      if (row.rows[0]?.owner_id !== ownerId) throw new RequestInProgressError();

      let response: IdempotentResponse<T>;
      try {
        response = await handler();
      } catch (error) {
        await this.deleteClaim(client, scope, key, ownerId);
        await client.query("COMMIT");
        transactionOpen = false;
        throw error;
      }
      if (response.status >= 500) {
        await this.deleteClaim(client, scope, key, ownerId);
      } else {
        const stored: StoredResponse = {
          hasBody: response.body !== undefined,
          body: response.body ?? null,
          requestId: response.requestId ?? null,
        };
        await client.query(
          `UPDATE idempotency_keys SET status = $3, response = $4::jsonb,
            in_progress_until = NULL, owner_id = NULL
           WHERE scope = $1 AND key = $2 AND owner_id = $5`,
          [scope, key, response.status, JSON.stringify(stored), ownerId],
        );
      }
      await client.query("COMMIT");
      transactionOpen = false;
      return { ...response, replayed: false };
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "55P03") throw new RequestInProgressError();
      throw error;
    } finally {
      client.release();
    }
  }

  private async deleteClaim(
    client: PoolClient,
    scope: string,
    key: string,
    ownerId: string,
  ): Promise<void> {
    await client.query(
      `DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND owner_id = $3`,
      [scope, key, ownerId],
    );
  }

  async cleanupExpired(batchSize = 1000): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000)
      throw new Error("Invalid idempotency cleanup batch size");
    const result = await this.pool.query(
      `WITH expired AS (
         SELECT scope, key FROM idempotency_keys WHERE expires_at <= clock_timestamp()
         ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED
       ) DELETE FROM idempotency_keys AS keys USING expired
         WHERE keys.scope = expired.scope AND keys.key = expired.key`,
      [batchSize],
    );
    return result.rowCount ?? 0;
  }
}

/** Register alongside the store to clear expired rows once per hour. */
@Injectable()
export class IdempotencyCleanup implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly store: IdempotencyStore) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () =>
        void this.store
          .cleanupExpired()
          .catch(() => process.stderr.write("Idempotency cleanup failed\n")),
      60 * 60 * 1000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

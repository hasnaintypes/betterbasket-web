export interface RateLimitCount {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitCount>;
}

type Entry = RateLimitCount;

/** A bounded, per-process store. A shared implementation can replace it later. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>();
  private lastNow = 0;
  private operations = 0;

  constructor(
    private readonly maxKeys = 10_000,
    private readonly clock: () => number = Date.now,
  ) {
    if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new Error("maxKeys must be positive");
  }

  async increment(key: string, windowMs: number): Promise<RateLimitCount> {
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("windowMs must be positive");
    const now = (this.lastNow = Math.max(this.lastNow, this.clock()));
    if (++this.operations % 64 === 0 || this.entries.size >= this.maxKeys) this.prune(now);
    const current = this.entries.get(key);
    if (current && current.resetAt > now) {
      current.count++;
      return { count: current.count, resetAt: current.resetAt };
    }
    if (current) this.entries.delete(key);
    if (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const entry = { count: 1, resetAt: now + windowMs };
    this.entries.set(key, entry);
    return { ...entry };
  }

  get size(): number {
    return this.entries.size;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
  }
}

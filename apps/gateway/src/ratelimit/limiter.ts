import { getRequestLogger } from "@betterbasket/runtime";
import { rateLimitPolicies, type RateLimitClass } from "./policy";
import type { RateLimitStore } from "./store";

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export class RateLimiter {
  storeFailuresTotal = 0;
  private lastNow = 0;

  constructor(
    private readonly store: RateLimitStore,
    private readonly clock: () => number = Date.now,
    private readonly onStoreFailure?: (total: number) => void,
  ) {}

  async check(rateClass: RateLimitClass, ip: string): Promise<RateLimitDecision | undefined> {
    const policy = rateLimitPolicies[rateClass];
    try {
      const { count, resetAt } = await this.store.increment(`${rateClass}:${ip}`, policy.windowMs);
      const now = (this.lastNow = Math.max(this.lastNow, this.clock()));
      return {
        allowed: count <= policy.limit,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - count),
        resetSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      };
    } catch {
      this.storeFailuresTotal++;
      try {
        if (this.onStoreFailure) this.onStoreFailure(this.storeFailuresTotal);
        else
          getRequestLogger()?.warn(
            { rateLimitStoreFailuresTotal: this.storeFailuresTotal },
            "rate-limit store unavailable; request allowed",
          );
      } catch {
        // Logging must not turn a store outage into a request failure.
      }
      return undefined;
    }
  }
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(decision.resetSeconds),
  };
}

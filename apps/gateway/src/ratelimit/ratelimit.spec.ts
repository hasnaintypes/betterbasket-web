import { InMemoryRateLimitStore, type RateLimitStore } from "./store";
import { RateLimiter } from "./limiter";
import { resolveRateLimitClass } from "./policy";
import { trustedClientIp } from "./client-ip";

describe("in-memory rate-limit store", () => {
  it("counts within a minute and resets after TTL", async () => {
    let now = 1_000;
    const store = new InMemoryRateLimitStore(10, () => now);
    expect(await store.increment("a", 60_000)).toEqual({ count: 1, resetAt: 61_000 });
    now += 30_000;
    expect(await store.increment("a", 60_000)).toEqual({ count: 2, resetAt: 61_000 });
    now = 61_000;
    expect(await store.increment("a", 60_000)).toEqual({ count: 1, resetAt: 121_000 });
  });

  it("bounds keys, evicts the oldest, and prunes expired keys", async () => {
    let now = 0;
    const store = new InMemoryRateLimitStore(2, () => now);
    await store.increment("a", 60_000);
    await store.increment("b", 60_000);
    await store.increment("c", 60_000);
    expect(store.size).toBe(2);
    expect((await store.increment("a", 60_000)).count).toBe(1);
    now = 61_000;
    await store.increment("d", 60_000);
    expect(store.size).toBe(1);
  });

  it("does not shorten a window when the wall clock moves backward", async () => {
    let now = 10_000;
    const store = new InMemoryRateLimitStore(10, () => now);
    await store.increment("a", 60_000);
    now = 1_000;
    expect(await store.increment("a", 60_000)).toEqual({ count: 2, resetAt: 70_000 });
  });
});

describe("rate-limit class and client IP", () => {
  it.each([
    ["POST", "/api/auth/sign-in/email", "auth-mutations"],
    ["POST", "/api/auth/sign-up/email", "auth-mutations"],
    ["POST", "/api/auth/reset-password", "auth-mutations"],
    ["POST", "/api/auth/sign%2din/email", "auth-mutations"],
    ["GET", "/api/auth/sign-in/email", "default"],
    ["GET", "/api/products", "default"],
    ["POST", "/webhooks/stripe/account", "webhooks"],
    ["POST", "/webhooks/stripe/connect", "webhooks"],
  ] as const)("resolves %s %s to %s", (method, path, expected) => {
    expect(resolveRateLimitClass(method, path)).toBe(expected);
  });

  it("resolves realtime upgrades to their own class", () => {
    expect(resolveRateLimitClass("GET", "/realtime/?EIO=4", true)).toBe("realtime-connect");
    expect(resolveRateLimitClass("GET", "/realtime/?EIO=4")).toBe("default");
  });

  it("ignores spoofed leftmost addresses and supports IPv6", () => {
    expect(trustedClientIp("127.0.0.1", "203.0.113.1", 0)).toBe("127.0.0.1");
    expect(trustedClientIp("127.0.0.1", "203.0.113.1, 2001:db8::1", 1)).toBe("2001:db8::1");
    expect(trustedClientIp("127.0.0.1", "203.0.113.1, 2001:db8::1", 2)).toBe("203.0.113.1");
    expect(trustedClientIp(undefined, undefined, 0)).toBe("unknown");
    expect(trustedClientIp("127.0.0.1", "invalid", 1)).toBe("127.0.0.1");
  });
});

it("fails open and increments a warning counter when the store throws", async () => {
  const failingStore: RateLimitStore = {
    increment: async () => {
      throw new Error("unavailable");
    },
  };
  const failures: number[] = [];
  const limiter = new RateLimiter(failingStore, Date.now, (total) => failures.push(total));
  expect(await limiter.check("default", "127.0.0.1")).toBeUndefined();
  expect(limiter.storeFailuresTotal).toBe(1);
  expect(failures).toEqual([1]);
});

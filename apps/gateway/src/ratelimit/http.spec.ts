import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request, Response } from "express";
import supertest from "supertest";
import type { GatewayConfig } from "../config";
import { registerRateLimiting } from "./http";
import { RateLimiter } from "./limiter";
import { InMemoryRateLimitStore } from "./store";

@Module({})
class EmptyModule {}

async function fixture(trustedHops = 0) {
  const app = await NestFactory.create(EmptyModule, { logger: false });
  const limiter = new RateLimiter(new InMemoryRateLimitStore(100, () => 0), () => 0);
  registerRateLimiting(app, { TRUSTED_PROXY_HOPS: trustedHops } as GatewayConfig, limiter);
  const expressApp = app.getHttpAdapter().getInstance();
  const respond = (_req: Request, res: Response) => res.json({ ok: true });
  expressApp.post("/api/auth/sign-in/email", respond);
  expressApp.get("/api/products", respond);
  expressApp.post("/webhooks/stripe/account", respond);
  await app.init();
  return { client: supertest(app.getHttpServer()), close: () => app.close() };
}

describe("gateway HTTP rate limiting", () => {
  it("returns 429 on the 21st sign-in despite spoofed forwarded addresses", async () => {
    const { client, close } = await fixture();
    try {
      for (let i = 0; i < 20; i++) {
        const response = await client
          .post("/api/auth/sign-in/email")
          .set("X-Forwarded-For", `203.0.113.${i + 1}`);
        expect(response.status).toBe(200);
        expect(response.headers["ratelimit-limit"]).toBe("20");
        expect(response.headers["ratelimit-remaining"]).toBe(String(19 - i));
        expect(response.headers["ratelimit-reset"]).toBe("60");
      }
      const blocked = await client
        .post("/api/auth/sign-in/email")
        .set("X-Forwarded-For", "198.51.100.200");
      expect(blocked.status).toBe(429);
      expect(blocked.headers["retry-after"]).toBe("60");
      expect(blocked.headers["ratelimit-remaining"]).toBe("0");
      expect(blocked.body.error).toEqual({
        code: "RATE_LIMITED",
        message: "Too many requests",
        requestId: blocked.headers["x-request-id"],
        details: [],
      });
    } finally {
      await close();
    }
  }, 20_000);

  it("uses the rightmost trusted forwarded address", async () => {
    const { client, close } = await fixture(1);
    try {
      for (let i = 0; i < 20; i++) {
        const response = await client
          .post("/api/auth/sign-in/email")
          .set("X-Forwarded-For", `203.0.113.${i + 1}, 198.51.100.7`);
        expect(response.status).toBe(200);
      }
      const blocked = await client
        .post("/api/auth/sign-in/email")
        .set("X-Forwarded-For", "192.0.2.9, 198.51.100.7");
      expect(blocked.status).toBe(429);
    } finally {
      await close();
    }
  }, 20_000);

  it("sends the default and webhook class headers", async () => {
    const { client, close } = await fixture();
    try {
      const ordinary = await client.get("/api/products");
      expect(ordinary.headers["ratelimit-limit"]).toBe("120");
      expect(ordinary.headers["ratelimit-remaining"]).toBe("119");
      const webhook = await client.post("/webhooks/stripe/account");
      expect(webhook.headers["ratelimit-limit"]).toBe("300");
      expect(webhook.headers["ratelimit-remaining"]).toBe("299");
    } finally {
      await close();
    }
  });
});

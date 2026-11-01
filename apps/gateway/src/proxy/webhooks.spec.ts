import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createHash, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { createStubUpstream } from "@betterbasket/test-utils";
import { json } from "express";
import supertest from "supertest";
import type { GatewayConfig } from "../config";
import { configureCors, registerSecurityHeaders } from "../cors";
import { registerWebhooks } from "./webhooks";

@Module({})
class EmptyModule {}

async function fixture(withLaterParser = false, paymentUrl?: string) {
  const stub = await createStubUpstream();
  const config = {
    PAYMENT_SERVICE_URL: paymentUrl ?? stub.url,
    CORS_ALLOWED_ORIGINS: ["https://web.example", "https://seller.example"],
  } as GatewayConfig;
  const app = await NestFactory.create(EmptyModule, { logger: false, bodyParser: false });
  registerSecurityHeaders(app);
  configureCors(app, config);
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get("/health", (_req: unknown, res: { end: (body: string) => void }) => res.end("ok"));
  registerWebhooks(app, config);
  if (withLaterParser) app.use(json());
  await app.init();
  return {
    app,
    stub,
    client: supertest(app.getHttpServer()),
    close: async () => {
      await app.close();
      await stub.close();
    },
  };
}

describe("gateway Stripe webhook pass-through", () => {
  for (const [name, body] of [
    ["ASCII", '{"id":"evt_123"}'],
    ["Unicode", '{"label":"\u2603 café"}'],
    ["unusual whitespace", ' {\r\n  "id" : "evt_123"  \t}\n'],
  ] as Array<[string, string]>) {
    it(`preserves ${name} webhook body bytes`, async () => {
      const { stub, client, close } = await fixture();
      try {
        const response = await client
          .post("/webhooks/stripe/account")
          .set("Content-Type", "application/json")
          .set("Stripe-Signature", "t=1,v1=test")
          .set("Authorization", "Bearer should-not-pass")
          .set("Cookie", "session=should-not-pass")
          .set("X-Internal-Token", "should-not-pass")
          .send(body);
        expect(response.status).toBe(200);
        expect(stub.requests[0]?.url).toBe("/payments/webhook/account");
        expect(stub.requests[0]?.bodySha256).toBe(createHash("sha256").update(body).digest("hex"));
        expect(stub.requests[0]?.headers["stripe-signature"]).toBe("t=1,v1=test");
        expect(stub.requests[0]?.headers["content-type"]).toBe("application/json");
        expect(stub.requests[0]?.headers.authorization).toBeUndefined();
        expect(stub.requests[0]?.headers.cookie).toBeUndefined();
        expect(stub.requests[0]?.headers["x-internal-token"]).toBeUndefined();
      } finally {
        await close();
      }
    });
  }

  it("routes connect webhook and ignores a later JSON parser", async () => {
    const { stub, client, close } = await fixture(true);
    try {
      const body = ' { "odd": [ 1,  2 ] } ';
      const response = await client
        .post("/webhooks/stripe/connect")
        .set("Content-Type", "application/json")
        .send(body);
      expect(response.status).toBe(200);
      expect(stub.requests[0]?.url).toBe("/payments/webhook/connect");
      expect(stub.requests[0]?.body.toString()).toBe(body);
    } finally {
      await close();
    }
  });

  it("enforces gateway security headers on an upstream webhook response", async () => {
    const { stub, client, close } = await fixture();
    try {
      stub.enqueue({ headers: { "X-Content-Type-Options": "unsafe" } });
      const response = await client.post("/webhooks/stripe/account").send("payload");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    } finally {
      await close();
    }
  });

  it("preserves a chunked webhook body", async () => {
    const { app, stub, close } = await fixture();
    try {
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address();
      if (!address || typeof address === "string") throw new Error("No gateway port");
      const chunks = [Buffer.from("first "), Buffer.from("☃ second")];
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port: address.port,
            method: "POST",
            path: "/webhooks/stripe/account",
            headers: { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          },
        );
        request.on("error", reject);
        for (const chunk of chunks) request.write(chunk);
        request.end();
      });
      expect(status).toBe(200);
      expect(stub.requests[0]?.body.equals(Buffer.concat(chunks))).toBe(true);
    } finally {
      await close();
    }
  });

  it("rejects a chunked body after crossing the streaming size limit", async () => {
    const upstream = createServer((request) => {
      request.on("error", () => {});
      request.resume();
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string")
      throw new Error("No upstream port");
    const { app, close } = await fixture(false, `http://127.0.0.1:${upstreamAddress.port}`);
    try {
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address();
      if (!address || typeof address === "string") throw new Error("No gateway port");
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port: address.port,
            method: "POST",
            path: "/webhooks/stripe/account",
            headers: { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          },
        );
        request.on("error", reject);
        request.write(Buffer.alloc(600 * 1024, 1));
        request.end(Buffer.alloc(600 * 1024, 2));
      });
      expect(status).toBe(413);
    } finally {
      await close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it.each(["GET", "PUT", "DELETE"])("returns 405 for %s", async (method) => {
    const { stub, client, close } = await fixture();
    try {
      const response = await client[method.toLowerCase() as "get" | "put" | "delete"](
        "/webhooks/stripe/account",
      );
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("POST");
      expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
      expect(stub.requests).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("returns 413 before forwarding a 2 MB body", async () => {
    const { stub, client, close } = await fixture();
    try {
      const response = await client
        .post("/webhooks/stripe/account")
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.alloc(2 * 1024 * 1024, 1));
      expect(response.status).toBe(413);
      expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
      expect(stub.requests).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("returns the configured CORS preflight only to allow-listed origins", async () => {
    const { client, close } = await fixture();
    try {
      const allowed = await client
        .options("/health")
        .set("Origin", "https://web.example")
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "Authorization,Content-Type");
      expect(allowed.status).toBe(204);
      expect(allowed.headers["access-control-allow-origin"]).toBe("https://web.example");
      expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
      expect(allowed.headers["access-control-allow-methods"]).toBe(
        "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      );
      expect(allowed.headers["access-control-allow-headers"]).toBe(
        "Authorization,Content-Type,Idempotency-Key,X-Request-Id",
      );
      expect(allowed.headers["access-control-expose-headers"]).toBe(
        "X-Request-Id,RateLimit-*,Retry-After",
      );
      expect(allowed.headers["access-control-max-age"]).toBe("600");
      for (const origin of ["https://evil.example", "null"]) {
        const denied = await client
          .options("/health")
          .set("Origin", origin)
          .set("Access-Control-Request-Method", "POST");
        expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
        expect(denied.headers["access-control-allow-credentials"]).toBeUndefined();
      }
    } finally {
      await close();
    }
  });

  it("sets security headers on health and auth responses", async () => {
    const { client, close } = await fixture();
    try {
      const health = await client.get("/health");
      expect(health.headers["x-content-type-options"]).toBe("nosniff");
      expect(health.headers["strict-transport-security"]).toContain("max-age=");
      expect(health.headers["referrer-policy"]).toBe("no-referrer");
      const auth = await client.get("/api/auth/ping").set("X-Request-Id", randomUUID());
      expect(auth.headers["cache-control"]).toBe("no-store");
    } finally {
      await close();
    }
  });
});

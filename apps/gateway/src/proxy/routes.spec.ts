import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createStubUpstream } from "@betterbasket/test-utils";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import supertest from "supertest";
import type { GatewayConfig } from "../config";
import { registerProxies } from "./register-proxies";
import { routes } from "./routes";

@Module({})
class EmptyModule {}

async function fixture(targets: Partial<GatewayConfig> = {}) {
  const stub = await createStubUpstream();
  const config = Object.fromEntries(
    routes.map((route) => [route.target, stub.url]),
  ) as unknown as GatewayConfig;
  const app = await NestFactory.create(EmptyModule, { logger: false });
  registerProxies(app, { ...config, ...targets });
  await app.init();
  return {
    stub,
    app,
    client: supertest(app.getHttpServer()),
    close: async () => {
      await app.close();
      await stub.close();
    },
  };
}

describe("gateway HTTP route table", () => {
  for (const route of routes) {
    it(`${route.prefix} rewrites path and preserves request data`, async () => {
      const { stub, client, close } = await fixture();
      const id = randomUUID();
      try {
        const body = JSON.stringify({ hello: "world" });
        const response = await client
          .post(`${route.prefix}/item?x=1&y=two`)
          .set("Content-Type", "application/json")
          .set("Cookie", "session=abc")
          .set("Authorization", "Bearer token")
          .set("X-Request-Id", id)
          .send(body);
        expect(response.status).toBe(200);
        expect(response.headers["x-request-id"]).toBe(id);
        expect(stub.requests).toHaveLength(1);
        const recorded = stub.requests[0];
        if (!recorded) throw new Error("Missing upstream request");
        expect(recorded.url).toBe(`${route.upstreamPrefix}/item?x=1&y=two`);
        expect(recorded.method).toBe("POST");
        expect(recorded.headers.cookie).toBe("session=abc");
        expect(recorded.headers.authorization).toBe("Bearer token");
        expect(recorded.headers["x-request-id"]).toBe(id);
        expect(recorded.body.toString()).toBe(body);
      } finally {
        await close();
      }
    });
  }

  it("rewrites the resource root without adding a trailing slash", async () => {
    const { stub, client, close } = await fixture();
    try {
      await client.get("/api/products?x=1");
      expect(stub.requests[0]?.url).toBe("/products?x=1");
    } finally {
      await close();
    }
  });

  it("preserves auth sign-in cookies and body", async () => {
    const { stub, client, close } = await fixture();
    try {
      await client
        .post("/api/auth/sign-in/email")
        .set("Cookie", "session=abc")
        .set("Content-Type", "application/json")
        .send('{"email":"a@example.test"}');
      expect(stub.requests[0]?.url).toBe("/api/auth/sign-in/email");
      expect(stub.requests[0]?.headers.cookie).toBe("session=abc");
      expect(stub.requests[0]?.body.toString()).toBe('{"email":"a@example.test"}');
    } finally {
      await close();
    }
  });

  it("strips connection-nominated request headers", async () => {
    const { stub, client, close } = await fixture();
    try {
      await client.get("/api/products/x").set("Connection", "x-hop").set("X-Hop", "secret");
      expect(stub.requests[0]?.headers["x-hop"]).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("passes upstream status and replaces an invalid request ID", async () => {
    const { stub, client, close } = await fixture();
    try {
      stub.enqueue({ status: 201, body: "created", headers: { "X-Request-Id": randomUUID() } });
      const response = await client.get("/api/products/x").set("X-Request-Id", "invalid");
      expect(response.status).toBe(201);
      expect(response.text).toBe("created");
      expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
      expect(stub.requests[0]?.headers["x-request-id"]).toBe(response.headers["x-request-id"]);
    } finally {
      await close();
    }
  });

  it("enforces auth cache policy over an upstream response", async () => {
    const { stub, client, close } = await fixture();
    try {
      stub.enqueue({ headers: { "Cache-Control": "public, max-age=3600" } });
      const response = await client.get("/api/auth/sign-in/email");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    } finally {
      await close();
    }
  });

  it.each([
    "/api/products/..%2f..%2fauth/x",
    "/api/products/%2e%2e/x",
    "/api/products/a//b",
    "/api/products/%252e%252e/x",
  ])("rejects traversal %s before proxying", async (path) => {
    const { stub, client, close } = await fixture();
    try {
      const response = await client.get(path);
      expect([400, 404]).toContain(response.status);
      expect(stub.requests).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("does not expose a notifications route", async () => {
    const { stub, client, close } = await fixture();
    try {
      expect((await client.get("/api/notifications")).status).toBe(404);
      expect(stub.requests).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("returns a safe 502 envelope for an unreachable upstream", async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const url = `http://127.0.0.1:${address.port}`;
    server.close();
    await once(server, "close");
    const unreachable = await fixture({ PRODUCT_SERVICE_URL: url });
    try {
      const response = await unreachable.client.get("/api/products/x");
      expect(response.status).toBe(502);
      expect(response.body.error).toEqual({
        code: "UPSTREAM_UNAVAILABLE",
        message: "Upstream service unavailable",
        requestId: response.headers["x-request-id"],
        details: [],
      });
      expect(unreachable.stub.requests).toHaveLength(0);
    } finally {
      await unreachable.close();
    }
  });

  it("returns a safe 504 envelope when the upstream does not respond", async () => {
    const stalled = createServer(() => {});
    stalled.listen(0, "127.0.0.1");
    await once(stalled, "listening");
    const address = stalled.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const fixtureApp = await fixture({ PRODUCT_SERVICE_URL: `http://127.0.0.1:${address.port}` });
    try {
      const response = await fixtureApp.client.get("/api/products/x");
      expect(response.status).toBe(504);
      expect(response.body.error).toEqual({
        code: "TIMEOUT",
        message: "Upstream request timed out",
        requestId: response.headers["x-request-id"],
        details: [],
      });
    } finally {
      await fixtureApp.close();
      stalled.closeAllConnections();
      await new Promise<void>((resolve) => stalled.close(() => resolve()));
    }
  }, 15_000);
});

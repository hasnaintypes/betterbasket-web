import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createStubUpstream } from "@betterbasket/test-utils";
import { createServer } from "node:http";
import { once } from "node:events";
import { Server as SocketServer } from "socket.io";
import { io } from "socket.io-client";
import supertest from "supertest";
import type { GatewayConfig } from "../config";
import { registerBlockedPaths } from "./blocked";
import { registerProxies, registerWebSocketUpgrades } from "./register-proxies";
import { routes } from "./routes";

@Module({})
class EmptyModule {}

async function fixture() {
  const stub = await createStubUpstream();
  const analyticsHttp = createServer();
  const sockets = new SocketServer(analyticsHttp, {
    path: "/socket.io",
    transports: ["websocket"],
  });
  let connections = 0;
  let handshakeUrl = "";
  sockets.of("/realtime").on("connection", (socket) => {
    connections++;
    handshakeUrl = socket.handshake.url;
    socket.on("echo", (message: string, acknowledge: (value: string) => void) =>
      acknowledge(message),
    );
  });
  analyticsHttp.listen(0, "127.0.0.1");
  await once(analyticsHttp, "listening");
  const analyticsAddress = analyticsHttp.address();
  if (!analyticsAddress || typeof analyticsAddress === "string")
    throw new Error("No analytics port");
  const config = Object.fromEntries(
    routes.map((route) => [route.target, stub.url]),
  ) as unknown as GatewayConfig;
  const completeConfig = {
    ...config,
    ANALYTICS_SERVICE_URL: `http://127.0.0.1:${analyticsAddress.port}`,
    CORS_ALLOWED_ORIGINS: ["https://allowed.example"],
  };
  const app = await NestFactory.create(EmptyModule, { logger: false });
  registerBlockedPaths(app);
  registerProxies(app, completeConfig);
  await app.listen(0, "127.0.0.1");
  registerWebSocketUpgrades(app.getHttpServer(), completeConfig);
  const gatewayAddress = app.getHttpServer().address();
  if (!gatewayAddress || typeof gatewayAddress === "string") throw new Error("No gateway port");
  return {
    base: `http://127.0.0.1:${gatewayAddress.port}`,
    client: supertest(app.getHttpServer()),
    stub,
    connections: () => connections,
    handshakeUrl: () => handshakeUrl,
    close: async () => {
      await app.close();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await stub.close();
    },
  };
}

describe("gateway WebSocket upgrades and blocked paths", () => {
  it("connects an allowed Socket.IO origin and echoes through analytics", async () => {
    const gateway = await fixture();
    const client = io(`${gateway.base}/realtime`, {
      path: "/realtime",
      transports: ["websocket"],
      extraHeaders: { Origin: "https://allowed.example" },
      reconnection: false,
      timeout: 3000,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });
      const echoed = await new Promise<string>((resolve) => client.emit("echo", "hello", resolve));
      expect(echoed).toBe("hello");
      expect(gateway.connections()).toBe(1);
      expect(gateway.handshakeUrl()).toMatch(/^\/socket\.io\/?\?EIO=/);
    } finally {
      client.disconnect();
      await gateway.close();
    }
  });

  it.each(["https://evil.example", "null", undefined])("rejects origin %s", async (origin) => {
    const gateway = await fixture();
    const client = io(`${gateway.base}/realtime`, {
      path: "/realtime",
      transports: ["websocket"],
      extraHeaders: origin ? { Origin: origin } : {},
      reconnection: false,
      timeout: 1500,
    });
    try {
      await new Promise<void>((resolve) => client.once("connect_error", () => resolve()));
      expect(gateway.connections()).toBe(0);
    } finally {
      client.disconnect();
      await gateway.close();
    }
  });

  it("destroys unknown upgrade paths", async () => {
    const gateway = await fixture();
    const client = io(gateway.base, {
      path: "/internal/x",
      transports: ["websocket"],
      extraHeaders: { Origin: "https://allowed.example" },
      reconnection: false,
      timeout: 1500,
    });
    try {
      await new Promise<void>((resolve) => client.once("connect_error", () => resolve()));
      expect(gateway.connections()).toBe(0);
    } finally {
      client.disconnect();
      await gateway.close();
    }
  });

  it.each(["/internal/x", "/internal", "/api/auth/jwks", "/api/auth/%6a%77%6b%73"])(
    "answers 404 for blocked HTTP path %s",
    async (path) => {
      const gateway = await fixture();
      try {
        const response = await gateway.client.get(path);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe("NOT_FOUND");
        expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
        expect(gateway.stub.requests).toHaveLength(0);
      } finally {
        await gateway.close();
      }
    },
  );

  it("does not proxy Socket.IO long polling over HTTP", async () => {
    const gateway = await fixture();
    try {
      const response = await gateway.client.get("/realtime/?EIO=4&transport=polling");
      expect(response.status).toBe(404);
      expect(gateway.connections()).toBe(0);
    } finally {
      await gateway.close();
    }
  });
});

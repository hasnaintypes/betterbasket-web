import { Module } from "@nestjs/common";
import { spawn, spawnSync } from "node:child_process";
import request from "supertest";
import { getReadinessRegistry } from "@betterbasket/runtime";
import { bootstrap } from "./main";
import { productEnvSchema } from "./config";

jest.setTimeout(60_000);

const validEnv = {
  NODE_ENV: "test",
  PORT: "4002",
  AUTH_ISSUER: "http://127.0.0.1:4000",
  AUTH_AUDIENCE: "http://127.0.0.1:4000",
  AUTH_JWKS_URL: "http://127.0.0.1:4001/api/auth/jwks",
  MONGODB_URI: "mongodb+srv://example.test/db",
  KAFKA_BROKERS: "broker.example.test:9092",
  KAFKA_USERNAME: "user",
  KAFKA_PASSWORD: "password",
  KAFKA_TOPIC_PREFIX: "test.",
};

@Module({})
class ProbeModule {}

describe("product-service bootstrap", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("exits non-zero and names a missing required variable", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...validEnv };
    delete env.MONGODB_URI;
    const child = spawnSync(
      process.execPath,
      ["-r", "ts-node/register/transpile-only", "src/main.ts"],
      {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain("MONGODB_URI");
  });

  it("boots with no HTTP CORS headers and drains readiness on shutdown", async () => {
    Object.assign(process.env, validEnv);
    const app = await bootstrap(ProbeModule);
    try {
      const server = app.getHttpServer();
      const health = await request(server).get("/health");
      expect(health.status).toBe(200);
      expect(health.body.service).toBe("product-service");
      expect((await request(server).get("/ready")).status).toBe(200);
      const preflight = await request(server)
        .options("/health")
        .set("Origin", "https://attacker.example");
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
      getReadinessRegistry(app).beginShutdown();
      expect((await request(server).get("/ready")).status).toBe(503);
    } finally {
      await app.close();
    }
    expect(productEnvSchema.safeParse({ ...validEnv, MONGODB_URI: undefined }).success).toBe(false);
  });

  it("exits within ten seconds of SIGTERM", async () => {
    const script = `const { Module } = require("@nestjs/common");
      class ProbeModule {}
      Module({})(ProbeModule);
      require("./src/main").bootstrap(ProbeModule).then(() => process.stdout.write("BOOTED\\n"));`;
    const child = spawn(process.execPath, ["-r", "ts-node/register/transpile-only", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, ...validEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    const booted = new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("BOOTED")) resolve();
      });
      child.once("exit", () => reject(new Error("Service exited before booting")));
    });
    child.stderr.on("data", () => {});
    const startupTimeout = setTimeout(() => child.kill("SIGKILL"), 45_000);
    let shutdownTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await booted;
      const started = Date.now();
      child.kill("SIGTERM");
      const result = await Promise.race([
        exit,
        new Promise<never>(
          (_, reject) =>
            (shutdownTimeout = setTimeout(
              () => reject(new Error("SIGTERM shutdown exceeded ten seconds")),
              10_000,
            )),
        ),
      ]);
      expect(result.code === 0 || result.signal === "SIGTERM").toBe(true);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      clearTimeout(startupTimeout);
      if (shutdownTimeout) clearTimeout(shutdownTimeout);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });
});

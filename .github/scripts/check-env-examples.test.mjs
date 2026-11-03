import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkApp, schemaKeys } from "./check-env-examples.mjs";

test("reads gateway-style schema keys", () => {
  assert.deepEqual(
    schemaKeys(
      "export const gatewayEnvSchema = z.object({ PORT: port(), AUTH_SERVICE_URL: url() });",
    ),
    ["AUTH_SERVICE_URL", "PORT"],
  );
});

test("example parity catches a new schema key", () => {
  const app = mkdtempSync(join(tmpdir(), "env-parity-"));
  try {
    mkdirSync(join(app, "src"));
    writeFileSync(
      join(app, "src/config.ts"),
      "export const appEnvSchema = z.object({ PORT: port(), AUTH_SERVICE_URL: url() });",
    );
    for (const environment of ["development", "production"]) {
      writeFileSync(join(app, `.env.${environment}.example`), "PORT=4000\n");
    }
    assert.equal(checkApp(app).length, 2);
    assert.match(checkApp(app)[0], /AUTH_SERVICE_URL/);
    for (const environment of ["development", "production"]) {
      writeFileSync(
        join(app, `.env.${environment}.example`),
        "PORT=4000\nAUTH_SERVICE_URL=http://localhost:4001\n",
      );
    }
    assert.deepEqual(checkApp(app), []);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test("migration-only direct URL is accepted for Drizzle services", () => {
  const app = mkdtempSync(join(tmpdir(), "env-migrator-"));
  try {
    mkdirSync(join(app, "src"));
    writeFileSync(
      join(app, "src/config.ts"),
      "export const appEnvSchema = z.object({ DATABASE_URL: url() });",
    );
    writeFileSync(
      join(app, "drizzle.config.ts"),
      "export default defineConfig({ dbCredentials: { url: process.env.DIRECT_DATABASE_URL } });",
    );
    for (const environment of ["development", "production"]) {
      writeFileSync(
        join(app, `.env.${environment}.example`),
        "DATABASE_URL=pooled\nDIRECT_DATABASE_URL=direct\n",
      );
    }
    assert.deepEqual(checkApp(app), []);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

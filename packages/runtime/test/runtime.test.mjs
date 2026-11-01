import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { z } = require("zod");
const { loadConfig, url, secret, csv, bool, port } = require("../dist/index.js");

test("loads a typed, deeply frozen config and ignores unknown keys", () => {
  const result = loadConfig(z.object({ PORT: port(), FLAGS: csv(), ENABLED: bool() }), {
    PORT: "4000",
    FLAGS: "one, two",
    ENABLED: "false",
    UNKNOWN: "ignored",
  });
  assert.deepEqual(result, { PORT: 4000, FLAGS: ["one", "two"], ENABLED: false });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.FLAGS));
});

test("helpers reject malformed URLs, placeholders, CSV, booleans, and ports", () => {
  assert.equal(url().safeParse("ftp://example.com").success, false);
  assert.equal(secret().safeParse("placeholder-value-1234").success, false);
  assert.equal(secret().safeParse("changeme-but-long-enough").success, false);
  assert.equal(secret().safeParse("short").success, false);
  assert.equal(csv().safeParse("one,,two").success, false);
  assert.equal(bool().safeParse("yes").success, false);
  for (const value of ["0", "65536", "3.2", "abc"])
    assert.equal(port().safeParse(value).success, false);
  assert.equal(port().parse("65535"), 65535);
  assert.equal(bool().parse("true"), true);
});

test("invalid config exits one and prints names without values", () => {
  const script = `const {z}=require('zod'); const {loadConfig,url,secret}=require('./dist/index.js'); loadConfig(z.object({AUTH_SERVICE_URL:url(), API_SECRET:secret()}), {AUTH_SERVICE_URL:'sensitive-value', API_SECRET:'placeholder-private-value'});`;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AUTH_SERVICE_URL/);
  assert.match(result.stderr, /API_SECRET/);
  assert.doesNotMatch(result.stderr, /sensitive-value|placeholder-private-value/);
});

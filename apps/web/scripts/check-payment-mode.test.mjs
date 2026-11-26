import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-payment-mode.mjs", import.meta.url));
const run = (key, flag) =>
  spawnSync(process.execPath, [script], {
    env: {
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: key,
      PAYMENTS_LIVE_MODE_ENABLED: flag,
    },
    encoding: "utf8",
  });

test("web build rejects a live publishable key while live mode is disabled", () => {
  const key = "pk_live_aaaaaaaaaaaaaaaaaaaa";
  const result = run(key, "false");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PAYMENTS_LIVE_MODE_ENABLED/);
  assert.doesNotMatch(result.stderr, new RegExp(key));
});

test("web build accepts a test publishable key", () => {
  assert.equal(run("pk_test_aaaaaaaaaaaaaaaaaaaa", "false").status, 0);
});

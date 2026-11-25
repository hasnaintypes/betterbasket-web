import { test } from "node:test";
import assert from "node:assert/strict";
import { safeReturnTo } from "../src/lib/return-to.mjs";

test("returnTo accepts local paths and rejects external or ambiguous targets", () => {
  assert.equal(safeReturnTo("/account?tab=sessions"), "/account?tab=sessions");
  for (const value of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "\n/account",
    null,
  ]) {
    assert.equal(safeReturnTo(value), "/");
  }
});

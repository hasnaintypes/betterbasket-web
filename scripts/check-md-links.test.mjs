import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFiles, slug, anchorsOf } from "./check-md-links.mjs";

const fixture = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "mdlinks-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
};

test("slug handles backticks, punctuation and spaces", () => {
  assert.equal(slug("2. Critical `defects` (none lost)"), "2-critical-defects-none-lost");
});

test("duplicate headings get -1 suffixes", () => {
  assert.deepEqual([...anchorsOf("# A\n## A\n")], ["a", "a-1"]);
});

test("valid relative links and anchors pass", () => {
  const dir = fixture({ "a.md": "# Top\n[b](b.md) [sec](b.md#section-one) [self](#top)\n", "b.md": "## Section One\n" });
  assert.deepEqual(checkFiles(dir, ["a.md", "b.md"]), []);
});

test("broken file link and missing anchor are reported", () => {
  const dir = fixture({ "a.md": "[x](nope.md)\n[y](b.md#missing)\n", "b.md": "# B\n" });
  const p = checkFiles(dir, ["a.md"]);
  assert.equal(p.length, 2);
  assert.match(p[0], /broken link "nope.md"/);
  assert.match(p[1], /missing anchor "#missing"/);
});

test("external links, inline code and fenced blocks are ignored", () => {
  const dir = fixture({ "a.md": "[e](https://example.com/x)\n`[c](nope.md)`\n```\n[f](nope.md)\n```\n" });
  assert.deepEqual(checkFiles(dir, ["a.md"]), []);
});

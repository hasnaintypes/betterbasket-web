import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dirname, "check-no-private-docs.sh");

function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), "nodocs-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}
const run = (dir) => spawnSync("sh", [script], { cwd: dir, encoding: "utf8" });

test("passes when only external docs URLs and the /docs route appear", () => {
  const dir = repoWith({ "a.md": "see https://nextjs.org/docs/app and Swagger at /docs\n" });
  assert.equal(run(dir).status, 0);
});

test("fails when a tracked file references the docs/ directory", () => {
  const dir = repoWith({ "a.ts": "// see docs/PRD.md for details\n" });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a\.ts:1/);
});

test("fails for markdown links into docs/", () => {
  const dir = repoWith({ "README.md": "[x](docs/guide.md)\n" });
  assert.equal(run(dir).status, 1);
});

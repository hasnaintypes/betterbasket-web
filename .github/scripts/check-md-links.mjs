#!/usr/bin/env node
// Validates relative links and #anchors in git-tracked Markdown files. Exits 1 on problems.
// Usage: node .github/scripts/check-md-links.mjs [--root <dir>]   (uses `git ls-files` when --root is not given)
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** GitHub-style heading slug (backticks and punctuation removed, spaces -> hyphens). */
export function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

export function anchorsOf(text) {
  const set = new Set();
  const counts = new Map();
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    const base = slug(m[1]);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    set.add(n === 0 ? base : `${base}-${n}`);
  }
  return set;
}

export function checkFiles(root, files) {
  const problems = [];
  const anchorCache = new Map();
  const anchors = (path) => {
    if (!anchorCache.has(path)) anchorCache.set(path, anchorsOf(readFileSync(path, "utf8")));
    return anchorCache.get(path);
  };
  for (const file of files) {
    const abs = join(root, file);
    let fenced = false;
    readFileSync(abs, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      if (fenced) return;
      const stripped = line.replace(/`[^`]*`/g, ""); // ignore inline code
      for (const m of stripped.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1];
        if (/^(https?:|mailto:|tel:|data:)/i.test(target)) continue;
        const [pathPart, frag] = target.split("#");
        const dest = pathPart ? normalize(join(dirname(abs), decodeURI(pathPart))) : abs;
        if (!existsSync(dest)) { problems.push(`${file}:${i + 1}: broken link "${target}"`); continue; }
        if (frag && statSync(dest).isFile() && dest.endsWith(".md") && !anchors(dest).has(decodeURI(frag).toLowerCase())) {
          problems.push(`${file}:${i + 1}: missing anchor "#${frag}" in ${pathPart || file}`);
        }
      }
    });
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--root");
  const root = i > 0 ? resolve(process.argv[i + 1]) : process.cwd();
  const files = execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const problems = checkFiles(root, files);
  problems.forEach((p) => console.error(p));
  console.log(`checked ${files.length} tracked Markdown files; ${problems.length} problem(s)`);
  process.exit(problems.length ? 1 : 0);
}

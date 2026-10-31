#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import * as contracts from "../dist/index.js";

const snapshotsDir = fileURLToPath(new URL("../schema-snapshots/", import.meta.url));

export function stable(value, key = "") {
  if (Array.isArray(value)) {
    const items = value.map((item) => stable(item));
    return key === "required" || key === "enum" ? items.sort((a, b) => String(a).localeCompare(String(b))) : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((name) => [name, stable(value[name], name)]));
  }
  return value;
}

export function snapshotsOf(exports) {
  const snapshots = new Map();
  for (const [name, schema] of Object.entries(exports)) {
    if (!(schema instanceof z.ZodType)) continue;
    const json = z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: ({ zodSchema }) => zodSchema._zod.def.type === "date"
        ? { type: "string", format: "date-time" }
        : "throw",
    });
    snapshots.set(`${name}.json`, `${JSON.stringify(stable(json), null, 2)}\n`);
  }
  return snapshots;
}

export function syncSnapshots(snapshots, directory, check = false) {
  if (!check) mkdirSync(directory, { recursive: true });
  const present = new Set(readdirSync(directory).filter((name) => name.endsWith(".json")));
  const problems = [];
  for (const [name, content] of snapshots) {
    const path = join(directory, name);
    if (check) {
      if (!present.has(name) || readFileSync(path, "utf8") !== content) problems.push(`${name} is missing or stale`);
    } else writeFileSync(path, content);
    present.delete(name);
  }
  for (const name of present) problems.push(`${name} is no longer exported`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = syncSnapshots(snapshotsOf(contracts), snapshotsDir, process.argv.includes("--check"));
  if (problems.length) {
    problems.forEach((problem) => console.error(problem));
    process.exitCode = 1;
  } else console.log(`${process.argv.includes("--check") ? "checked" : "wrote"} ${snapshotsOf(contracts).size} schema snapshots`);
}

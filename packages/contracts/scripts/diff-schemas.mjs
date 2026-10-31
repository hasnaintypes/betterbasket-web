#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = fileURLToPath(new URL("../schema-snapshots/", import.meta.url));
const prefix = "packages/contracts/schema-snapshots/";

export function breakingChanges(before, after, path = "$", problems = []) {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") {
    if (JSON.stringify(before) !== JSON.stringify(after)) problems.push(`${path}: value changed`);
    return problems;
  }
  if (JSON.stringify(before.type) !== JSON.stringify(after.type)) problems.push(`${path}: type changed`);
  if (before.enum) {
    if (!after.enum || before.enum.some((value) => !after.enum.includes(value))) problems.push(`${path}: enum value removed`);
  }
  const oldProperties = before.properties || {};
  const newProperties = after.properties || {};
  for (const [name, schema] of Object.entries(oldProperties)) {
    if (!(name in newProperties)) problems.push(`${path}.${name}: property removed`);
    else breakingChanges(schema, newProperties[name], `${path}.${name}`, problems);
  }
  const oldRequired = new Set(before.required || []);
  for (const name of after.required || []) {
    if (!oldRequired.has(name)) problems.push(`${path}.${name}: became required`);
  }
  if (before.items || after.items) breakingChanges(before.items, after.items, `${path}[]`, problems);
  if (before.additionalProperties && typeof before.additionalProperties === "object") {
    breakingChanges(before.additionalProperties, after.additionalProperties, `${path}{}`, problems);
  } else if (before.additionalProperties !== false && after.additionalProperties === false) {
    problems.push(`${path}: additional properties no longer accepted`);
  }
  for (const key of [
    "anyOf", "oneOf", "allOf", "not", "const", "format", "pattern",
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties", "uniqueItems",
  ]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) problems.push(`${path}: ${key} changed`);
  }
  return problems;
}

export function compareSnapshots(previous, current) {
  const problems = [];
  for (const [name, before] of previous) {
    const after = current.get(name);
    if (!after) problems.push(`${name}: exported schema removed`);
    else breakingChanges(before, after, name, problems);
  }
  return problems;
}

function currentSnapshots() {
  return new Map(readdirSync(directory).filter((name) => name.endsWith(".json"))
    .map((name) => [name, JSON.parse(readFileSync(join(directory, name), "utf8"))]));
}

function baseSnapshots(base) {
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", base, "--", prefix], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  return new Map(paths.map((path) => [basename(path), JSON.parse(execFileSync("git", ["show", `${base}:${path}`], { cwd: root, encoding: "utf8" }))]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const base = process.argv[2];
    if (!base) throw new Error("usage: node diff-schemas.mjs <base-ref>");
    const problems = compareSnapshots(baseSnapshots(base), currentSnapshots());
    problems.forEach((problem) => console.error(problem));
    console.log(`contract comparison: ${problems.length} breaking change(s)`);
    if (problems.length) process.exitCode = 1;
  } catch (error) {
    console.error(`contract comparison failed: ${error.message}`);
    process.exitCode = 1;
  }
}

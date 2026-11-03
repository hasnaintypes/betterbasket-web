import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serviceDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(serviceDir, "src", "db", "schema.auth.ts");

export function normalizeGeneratedSchema(schema) {
  const importLine =
    'import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";';
  if (!schema.includes(importLine)) throw new Error("Unexpected Better Auth schema imports");
  let result = schema.replace(importLine, importLine.replace("index }", "index, uniqueIndex }"));
  result = result.replace(/timestamp\("([a-z_]+)"\)/g, 'timestamp("$1", { withTimezone: true })');
  const memberIndex = 'index("member_userId_idx").on(table.userId),';
  if (!result.includes(memberIndex)) throw new Error("Expected member index is missing");
  result = result.replace(
    memberIndex,
    `${memberIndex}\n    uniqueIndex("member_organization_user_unique").on(table.organizationId, table.userId),`,
  );
  return result;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !["--write", "--check"].includes(argv[0])) {
    throw new Error("Usage: node scripts/generate-auth-schema.mjs --write|--check");
  }
  const temporaryDir = mkdtempSync(join(tmpdir(), "betterbasket-auth-schema-"));
  try {
    const output = join(temporaryDir, "schema.ts");
    execFileSync(
      "pnpm",
      ["exec", "auth", "generate", "--config", "src/auth/auth.cli.ts", "--output", output, "--yes"],
      { cwd: serviceDir, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
    );
    const generated = normalizeGeneratedSchema(readFileSync(output, "utf8"));
    if (argv[0] === "--write") {
      writeFileSync(target, generated);
    } else if (readFileSync(target, "utf8") !== generated) {
      throw new Error("Better Auth schema differs from the committed generated file");
    }
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("Install dependencies with pnpm before generating the auth schema");
    if (
      error.message.startsWith("Better Auth schema") ||
      error.message.startsWith("Unexpected") ||
      error.message.startsWith("Expected")
    )
      throw error;
    throw new Error("Better Auth schema generation failed; CLI output was withheld");
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

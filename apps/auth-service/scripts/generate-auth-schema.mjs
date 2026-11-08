import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serviceDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(serviceDir, "src", "db", "schema.auth.ts");

export function normalizeGeneratedSchema(schema) {
  const importBlock = schema.match(/import \{[\s\S]*?\} from "drizzle-orm\/pg-core";/)?.[0];
  if (!importBlock || !/\bindex,(?=\s*\})/.test(importBlock))
    throw new Error("Unexpected Better Auth schema imports");
  const separator = importBlock.includes("\n") ? "\n  " : " ";
  let result = schema.replace(
    importBlock,
    importBlock.replace(/\bindex,(?=\s*\})/, `index,${separator}uniqueIndex,`),
  );
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
      {
        cwd: serviceDir,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: "4001",
          ENABLE_DOCS: "false",
          GIT_SHA: "schema-generation",
          BASE_URL: "http://localhost:4000",
          TRUSTED_ORIGINS: "http://localhost:3000",
          BETTER_AUTH_SECRET: "schema-generation-only-secret-with-at-least-32-bytes",
          DATABASE_URL: "postgresql://schema:schema@localhost:5432/schema",
        },
      },
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

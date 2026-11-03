import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertDevelopmentProject,
  assertDevelopmentMetadata,
  main,
  parseArgs,
  pooledRuntimeUrl,
  updateEnv,
  validateConnectionUrls,
} from "./dev-bootstrap.mjs";

const args = [
  "--project-id",
  "dev-project-123",
  "--branch",
  "dev-alex",
  "--runtime-role",
  "app_user",
  "--migrator-role",
  "migrator",
];
const runtime =
  "postgresql://app_user:secret@ep-example-pooler.us-east-1.aws.neon.tech/bb_auth?sslmode=require";
const direct =
  "postgresql://migrator:other-secret@ep-example.us-east-1.aws.neon.tech/bb_auth?sslmode=require";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "dev-bootstrap-"));
  mkdirSync(join(directory, "apps", "auth-service"), { recursive: true });
  writeFileSync(join(directory, ".dev-projects"), "# Development only\ndev-project-123\n");
  writeFileSync(
    join(directory, "apps", "auth-service", ".env.development.example"),
    "PORT=4001\nDATABASE_URL=placeholder\n",
  );
  return directory;
}

test("only explicitly approved development project IDs pass", () => {
  assert.doesNotThrow(() => assertDevelopmentProject("dev-project-123", "dev-project-123\n"));
  assert.throws(
    () => assertDevelopmentProject("prod-project-123", "dev-project-123\n"),
    /allow-list/,
  );
  assert.throws(() => parseArgs([...args, "--branch", "prod-main"]), /Branch must start/);
  assert.doesNotThrow(() =>
    assertDevelopmentMetadata(
      "dev-project-123",
      JSON.stringify({ project: { id: "dev-project-123", name: "BetterBasket dev auth" } }),
    ),
  );
  assert.throws(
    () =>
      assertDevelopmentMetadata(
        "dev-project-123",
        JSON.stringify({ project: { id: "dev-project-123", name: "BetterBasket staging" } }),
      ),
    /development project/,
  );
});

test("runtime and migration connections use separate roles and matching Neon endpoints", () => {
  assert.doesNotThrow(() =>
    validateConnectionUrls(runtime, direct, "app_user", "migrator", "bb_auth"),
  );
  assert.throws(
    () =>
      validateConnectionUrls(
        runtime.replace("ep-example", "ep-production"),
        direct,
        "app_user",
        "migrator",
      ),
    /development Neon host/,
  );
  assert.throws(
    () =>
      validateConnectionUrls(
        runtime,
        direct.replace("ep-example", "ep-other"),
        "app_user",
        "migrator",
      ),
    /same branch/,
  );
  assert.throws(
    () => validateConnectionUrls(direct, runtime, "migrator", "app_user"),
    /same branch/,
  );
  assert.throws(
    () => validateConnectionUrls(runtime, direct, "app_user", "migrator", "bb_payment"),
    /same branch/,
  );
  assert.throws(() => parseArgs([...args, "--runtime-role", "neondb_owner"]), /runtime cannot/);
  assert.equal(pooledRuntimeUrl(direct, "app_user", "secret"), runtime);
});

test("environment updates preserve unrelated settings and replace duplicate URLs", () => {
  const result = updateEnv(
    "PORT=4001\nDATABASE_URL=old\nOTHER=x\nexport DATABASE_URL=duplicate\n",
    runtime,
    direct,
  );
  assert.equal(
    result,
    `PORT=4001\nDATABASE_URL=${runtime}\nOTHER=x\nDIRECT_DATABASE_URL=${direct}\n`,
  );
});

test("dry run checks the allow-list without writing an environment file", async () => {
  const directory = fixture();
  await main([...args, "--dry-run"], {}, directory);
  assert.throws(
    () => readFileSync(join(directory, "apps", "auth-service", ".env.development")),
    /ENOENT/,
  );
  await assert.rejects(
    main([...args, "--project-id", "prod-project-123", "--dry-run"], {}, directory),
    /allow-list/,
  );
});

test("manual fallback writes private URLs without replacing unrelated settings", async () => {
  const directory = fixture();
  await main(
    [...args, "--manual"],
    { NEON_RUNTIME_URL: runtime, NEON_DIRECT_URL: direct },
    directory,
    async () => {},
  );
  const contents = readFileSync(
    join(directory, "apps", "auth-service", ".env.development"),
    "utf8",
  );
  assert.match(contents, /PORT=4001/);
  assert.match(contents, /DATABASE_URL=postgresql:\/\/app_user/);
  assert.match(contents, /DIRECT_DATABASE_URL=postgresql:\/\/migrator/);
});

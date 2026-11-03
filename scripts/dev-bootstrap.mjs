#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const services = new Set(["auth", "seller", "order", "payment"]);
const projectIdPattern = /^[a-z0-9][a-z0-9-]{0,59}$/;
const branchPattern = /^dev-[a-z0-9][a-z0-9-]{0,39}$/;
const rolePattern = /^[a-z_][a-z0-9_]{0,62}$/;

export function parseArgs(argv) {
  const options = {
    service: "auth",
    dryRun: false,
    existing: false,
    manual: false,
    migrate: false,
    seed: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (["--dry-run", "--existing", "--manual", "--migrate", "--seed"].includes(arg)) {
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
    } else if (
      ["--project-id", "--branch", "--service", "--runtime-role", "--migrator-role"].includes(arg)
    ) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!projectIdPattern.test(options.projectId ?? "")) throw new Error("Pass a valid --project-id");
  if (!branchPattern.test(options.branch ?? ""))
    throw new Error(
      "Branch must start with dev- and contain only lowercase letters, digits, and hyphens",
    );
  if (!services.has(options.service))
    throw new Error("Service must be auth, seller, order, or payment");
  if (
    !rolePattern.test(options.runtimeRole ?? "") ||
    !rolePattern.test(options.migratorRole ?? "")
  ) {
    throw new Error("Pass valid --runtime-role and --migrator-role names");
  }
  if (options.runtimeRole === options.migratorRole || options.runtimeRole === "neondb_owner") {
    throw new Error("Runtime and migrator roles must differ; runtime cannot be neondb_owner");
  }
  return options;
}

export function assertDevelopmentProject(projectId, allowlist) {
  const allowed = new Set(
    allowlist
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  if (!allowed.has(projectId))
    throw new Error("Project ID is not in the local .dev-projects allow-list");
}

export function assertDevelopmentMetadata(projectId, output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Neon CLI returned unrecognized project metadata");
  }
  const project = parsed?.project ?? parsed;
  if (
    project?.id !== projectId ||
    typeof project.name !== "string" ||
    !/(^|[-_ ])dev(elopment)?($|[-_ ])/i.test(project.name) ||
    /(^|[-_ ])(?:stage|staging|prod|production)($|[-_ ])/i.test(project.name)
  ) {
    throw new Error(
      "Project must be an explicitly named development project, separate from staging and production",
    );
  }
}

function endpointBase(hostname) {
  return hostname.replace(/-pooler(?=\.)/, "");
}

export function validateConnectionUrls(
  runtimeValue,
  directValue,
  runtimeRole,
  migratorRole,
  databaseName,
) {
  let runtime;
  let direct;
  try {
    runtime = new URL(runtimeValue);
    direct = new URL(directValue);
  } catch {
    throw new Error("Connection URLs are invalid");
  }
  for (const url of [runtime, direct]) {
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname.endsWith(".neon.tech") ||
      /(^|[-.])(stage|staging|prod|production)([-.]|$)/i.test(url.hostname) ||
      !url.username ||
      !url.password ||
      !url.pathname ||
      url.pathname === "/" ||
      url.searchParams.get("sslmode") !== "require"
    ) {
      throw new Error(
        "Connections must use a development Neon host, credentials, database, and sslmode=require",
      );
    }
  }
  if (
    !runtime.hostname.includes("-pooler.") ||
    direct.hostname.includes("-pooler.") ||
    endpointBase(runtime.hostname) !== direct.hostname ||
    runtime.pathname !== direct.pathname ||
    (databaseName && decodeURIComponent(direct.pathname.slice(1)) !== databaseName) ||
    decodeURIComponent(runtime.username) !== runtimeRole ||
    decodeURIComponent(direct.username) !== migratorRole
  ) {
    throw new Error(
      "Pooled runtime and direct migrator URLs must target the same branch and use their respective roles",
    );
  }
}

export function updateEnv(contents, runtimeUrl, directUrl) {
  const values = { DATABASE_URL: runtimeUrl, DIRECT_DATABASE_URL: directUrl };
  const seen = new Set();
  const lines = contents
    .split(/\r?\n/)
    .filter((line) => {
      const match = /^\s*(?:export\s+)?(DATABASE_URL|DIRECT_DATABASE_URL)\s*=/.exec(line);
      if (!match) return true;
      if (seen.has(match[1])) return false;
      seen.add(match[1]);
      return true;
    })
    .map((line) => {
      const match = /^\s*(?:export\s+)?(DATABASE_URL|DIRECT_DATABASE_URL)\s*=/.exec(line);
      return match ? `${match[1]}=${values[match[1]]}` : line;
    });
  while (lines.at(-1) === "") lines.pop();
  for (const key of Object.keys(values)) if (!seen.has(key)) lines.push(`${key}=${values[key]}`);
  return `${lines.join("\n")}\n`;
}

function runNeon(args) {
  try {
    return execFileSync("neon", [...args, "--output", "json", "--no-color"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    }).trim();
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(
        "Neon CLI is unavailable. Install it or use --manual with NEON_RUNTIME_URL and NEON_DIRECT_URL",
      );
    throw new Error(
      "Neon CLI failed. Check authentication, project access, role names, branch limits, and network connectivity; CLI output was withheld to protect secrets",
    );
  }
}

function connectionString(branch, projectId, role, databaseName, pooled) {
  const args = [
    "connection-string",
    branch,
    "--project-id",
    projectId,
    "--role-name",
    role,
    "--database-name",
    databaseName,
  ];
  if (pooled) args.push("--pooled");
  const output = runNeon(args);
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = output;
  }
  const value =
    typeof parsed === "string"
      ? parsed
      : (parsed?.connection_string ?? parsed?.connectionString ?? parsed?.uri);
  if (typeof value !== "string")
    throw new Error("Neon CLI returned an unrecognized connection-string format");
  return value;
}

function pgClient(connectionString) {
  const requireFromService = createRequire(join(root, "apps", "auth-service", "package.json"));
  const { Client } = requireFromService("pg");
  return new Client({ connectionString, connectionTimeoutMillis: 15_000 });
}

export function pooledRuntimeUrl(directValue, role, password) {
  const url = new URL(directValue);
  url.hostname = url.hostname.replace(/^([^.]+)\./, "$1-pooler.");
  url.username = role;
  url.password = password;
  return url.toString();
}

async function createRuntimeRole(directUrl, runtimeRole) {
  const client = pgClient(directUrl);
  const password = randomBytes(32).toString("base64url");
  try {
    await client.connect();
    const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [runtimeRole]);
    if (existing.rowCount)
      throw new Error("Runtime role already exists; use --manual with its existing connection URL");
    await client.query(
      `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${password}' NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    const privilege = await client.query(
      "SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create",
      [runtimeRole],
    );
    if (privilege.rows[0]?.can_create)
      throw new Error("Runtime role unexpectedly has schema CREATE privilege");
    return pooledRuntimeUrl(directUrl, runtimeRole, password);
  } catch (error) {
    if (error.message.startsWith("Runtime role")) throw error;
    throw new Error(
      "Could not configure the restricted runtime role; check branch access and database privileges. Database details were withheld",
    );
  } finally {
    await client.end().catch(() => {});
  }
}

async function verifyRestrictedRole(runtimeUrl, expectedRole) {
  const client = pgClient(runtimeUrl);
  try {
    await client.connect();
    const result = await client.query(`SELECT current_user AS role_name,
      has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
      has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
      pg_has_role(current_user, 'neon_superuser', 'member') AS neon_superuser
      FROM pg_roles r WHERE r.rolname = current_user`);
    const row = result.rows[0];
    if (
      row?.role_name !== expectedRole ||
      row.schema_create ||
      row.database_create ||
      row.rolcreatedb ||
      row.rolcreaterole ||
      row.rolreplication ||
      row.rolbypassrls ||
      row.neon_superuser
    ) {
      throw new Error("Runtime role has unexpected DDL or elevated privileges");
    }
  } catch (error) {
    if (error.message.startsWith("Runtime role")) throw error;
    throw new Error("Could not verify runtime role privileges; database details were withheld");
  } finally {
    await client.end().catch(() => {});
  }
}

function assertEnvTarget(baseDir, service) {
  const path = join(baseDir, "apps", `${service}-service`, ".env.development");
  if (existsSync(path) && !lstatSync(path).isFile())
    throw new Error("Environment target must be a regular file");
  if (!existsSync(path) && !existsSync(`${path}.example`))
    throw new Error("Environment example is missing");
  return path;
}

function writeEnv(baseDir, service, runtimeUrl, directUrl) {
  const path = assertEnvTarget(baseDir, service);
  const example = `${path}.example`;
  const original = readFileSync(existsSync(path) ? path : example, "utf8");
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, updateEnv(original, runtimeUrl, directUrl), { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  baseDir = root,
  verifyRole = verifyRestrictedRole,
) {
  const options = parseArgs(argv);
  const databaseName = `bb_${options.service}`;
  const allowlistPath = join(baseDir, ".dev-projects");
  if (!existsSync(allowlistPath))
    throw new Error(
      "Create .dev-projects with one approved free-tier development project ID per line",
    );
  assertDevelopmentProject(options.projectId, readFileSync(allowlistPath, "utf8"));
  const serviceDir = join(baseDir, "apps", `${options.service}-service`);
  if (options.migrate && !existsSync(join(serviceDir, "drizzle", "meta", "_journal.json"))) {
    throw new Error("No committed Drizzle migrations exist for this service yet");
  }
  if (
    options.seed &&
    !JSON.parse(readFileSync(join(serviceDir, "package.json"), "utf8")).scripts?.["db:seed"]
  ) {
    throw new Error("No db:seed script exists for this service yet");
  }
  if (options.dryRun) {
    process.stdout.write(
      `Dry run: ${options.existing ? "use" : "create"} branch ${options.branch} in approved project ${options.projectId}; configure ${databaseName} for ${options.service}-service with pooled runtime and direct migrator URLs. No cloud or file changes.\n`,
    );
    return;
  }
  assertEnvTarget(baseDir, options.service);
  let runtimeUrl;
  let directUrl;
  if (options.manual) {
    runtimeUrl = env.NEON_RUNTIME_URL;
    directUrl = env.NEON_DIRECT_URL;
    if (!runtimeUrl || !directUrl)
      throw new Error(
        "Manual mode requires NEON_RUNTIME_URL and NEON_DIRECT_URL in the process environment",
      );
  } else {
    assertDevelopmentMetadata(options.projectId, runNeon(["project", "get", options.projectId]));
    if (!options.existing)
      runNeon([
        "branch",
        "create",
        "--project-id",
        options.projectId,
        "--name",
        options.branch,
        "--no-secrets",
      ]);
    const databasesOutput = runNeon([
      "databases",
      "list",
      "--project-id",
      options.projectId,
      "--branch",
      options.branch,
    ]);
    let databases;
    try {
      databases = JSON.parse(databasesOutput);
    } catch {
      throw new Error("Neon CLI returned unrecognized database metadata");
    }
    if (!Array.isArray(databases))
      throw new Error("Neon CLI returned unrecognized database metadata");
    if (!databases.some((database) => database.name === databaseName)) {
      runNeon([
        "databases",
        "create",
        "--project-id",
        options.projectId,
        "--branch",
        options.branch,
        "--name",
        databaseName,
        "--owner-name",
        options.migratorRole,
      ]);
    }
    directUrl = connectionString(
      options.branch,
      options.projectId,
      options.migratorRole,
      databaseName,
      false,
    );
    validateConnectionUrls(
      pooledRuntimeUrl(directUrl, options.runtimeRole, "temporary"),
      directUrl,
      options.runtimeRole,
      options.migratorRole,
      databaseName,
    );
    runtimeUrl = await createRuntimeRole(directUrl, options.runtimeRole);
  }
  validateConnectionUrls(
    runtimeUrl,
    directUrl,
    options.runtimeRole,
    options.migratorRole,
    databaseName,
  );
  await verifyRole(runtimeUrl, options.runtimeRole);
  writeEnv(baseDir, options.service, runtimeUrl, directUrl);
  for (const [enabled, script] of [
    [options.migrate, "db:migrate"],
    [options.seed, "db:seed"],
  ]) {
    if (!enabled) continue;
    try {
      execFileSync("pnpm", ["--filter", `${options.service}-service`, script], {
        cwd: baseDir,
        env: { ...env, NODE_ENV: "development" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch {
      throw new Error(
        `${script} failed. Check service configuration and the development database; output was withheld to protect secrets`,
      );
    }
  }
  process.stdout.write(
    `Configured apps/${options.service}-service/.env.development for approved project ${options.projectId}, branch ${options.branch}. Credentials were not printed.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

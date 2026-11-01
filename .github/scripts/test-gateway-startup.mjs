import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const gatewayDir = join(process.cwd(), "apps/gateway");
const env = { ...process.env };
for (const line of readFileSync(join(gatewayDir, ".env.development.example"), "utf8").split(
  /\r?\n/,
)) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (match) env[match[1]] = match[2];
}
delete env.AUTH_SERVICE_URL;
env.PRODUCT_SERVICE_URL = "http://private-sentinel.example";
const result = spawnSync(process.execPath, ["dist/main.js"], {
  cwd: gatewayDir,
  env,
  encoding: "utf8",
  timeout: 10_000,
});
if (
  result.status !== 1 ||
  !result.stderr.includes("AUTH_SERVICE_URL") ||
  `${result.stderr}${result.stdout}`.includes("private-sentinel")
) {
  console.error("Gateway startup failure/redaction check failed", {
    status: result.status,
    signal: result.signal,
  });
  process.exitCode = 1;
} else {
  console.log("Gateway rejects missing AUTH_SERVICE_URL without logging values.");
}

#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultWaivers = fileURLToPath(new URL("../security-waivers.yml", import.meta.url));
const highSeverities = new Set(["high", "critical"]);

export function validateWaivers(document, today = new Date().toISOString().slice(0, 10)) {
  if (!document || !Array.isArray(document.waivers))
    throw new Error("security-waivers.yml must contain a waivers array");
  const ids = new Set();
  for (const waiver of document.waivers) {
    if (!waiver || typeof waiver !== "object") throw new Error("Every waiver must be an object");
    for (const field of ["id", "reason", "owner", "expires"]) {
      if (typeof waiver[field] !== "string" || !waiver[field].trim())
        throw new Error(`Waiver ${waiver.id || "(missing id)"} needs ${field}`);
    }
    if (ids.has(waiver.id)) throw new Error(`Duplicate waiver ${waiver.id}`);
    ids.add(waiver.id);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(waiver.expires) ||
      Number.isNaN(Date.parse(`${waiver.expires}T00:00:00Z`))
    ) {
      throw new Error(`Waiver ${waiver.id} has an invalid expiry`);
    }
    if (waiver.expires < today) throw new Error(`Waiver ${waiver.id} expired on ${waiver.expires}`);
  }
  return new Set(document.waivers.map((waiver) => waiver.id));
}

export function findingsFromAudit(report) {
  if (!report || typeof report.advisories !== "object")
    throw new Error("Invalid pnpm audit report");
  return Object.values(report.advisories)
    .filter((advisory) => highSeverities.has(advisory.severity?.toLowerCase()))
    .map((advisory) => advisory.github_advisory_id || String(advisory.id));
}

export function findingsFromDependencyReview(changes) {
  if (!Array.isArray(changes)) throw new Error("Invalid dependency review output");
  return changes.flatMap((change) =>
    (change.vulnerabilities || [])
      .filter((vulnerability) => highSeverities.has(vulnerability.severity?.toLowerCase()))
      .map(
        (vulnerability) =>
          vulnerability.advisory_ghsa_id ||
          vulnerability.advisory_url?.match(/GHSA-[\w-]+/)?.[0] ||
          vulnerability.advisory_id,
      )
      .filter(Boolean),
  );
}

export function findingsFromSarif(report) {
  if (!Array.isArray(report?.runs)) throw new Error("Invalid CodeQL SARIF report");
  return report.runs.flatMap((run) => {
    const rules = new Map((run.tool?.driver?.rules || []).map((rule) => [rule.id, rule]));
    return (run.results || [])
      .filter((result) => {
        const rule = rules.get(result.ruleId);
        const score = Number(rule?.properties?.["security-severity"]);
        return score >= 7 || (Number.isNaN(score) && result.level === "error");
      })
      .map((result) => result.ruleId)
      .filter(Boolean);
  });
}

export function unwaived(findings, waivers) {
  return [...new Set(findings)].filter((id) => !waivers.has(id));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const [kind = "validate", reportPath, waiverPath = defaultWaivers] = process.argv.slice(2);
    const waivers = validateWaivers(readJson(waiverPath));
    if (kind === "validate") {
      console.log(`validated ${waivers.size} security waivers`);
    } else {
      if (!reportPath) throw new Error("A report path is required");
      let findings;
      if (kind === "audit") findings = findingsFromAudit(readJson(reportPath));
      else if (kind === "dependency-review")
        findings = findingsFromDependencyReview(readJson(reportPath));
      else if (kind === "codeql") {
        const reports = readdirSync(reportPath).filter((name) => name.endsWith(".sarif"));
        if (!reports.length) throw new Error("CodeQL produced no SARIF report");
        findings = reports.flatMap((name) => findingsFromSarif(readJson(join(reportPath, name))));
      } else throw new Error(`Unknown report type ${kind}`);
      const blocked = unwaived(findings, waivers);
      if (blocked.length) {
        console.error(`${kind}: unwaived high or critical findings: ${blocked.join(", ")}`);
        process.exitCode = 1;
      } else console.log(`${kind}: no unwaived high or critical findings`);
    }
  } catch (error) {
    console.error(`${basename(process.argv[1])}: ${error.message}`);
    process.exitCode = 1;
  }
}

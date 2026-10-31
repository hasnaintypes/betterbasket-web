import test from "node:test";
import assert from "node:assert/strict";
import {
  findingsFromAudit,
  findingsFromDependencyReview,
  findingsFromSarif,
  unwaived,
  validateWaivers,
} from "./check-waivers.mjs";

const valid = {
  waivers: [
    {
      id: "GHSA-example",
      reason: "Tracked remediation",
      owner: "maintainer",
      expires: "2099-01-01",
    },
  ],
};

test("active waiver covers its ID", () => {
  const waivers = validateWaivers(valid, "2026-10-31");
  assert.deepEqual(unwaived(["GHSA-example", "GHSA-other"], waivers), ["GHSA-other"]);
});

test("expired waiver fails and names its ID", () => {
  assert.throws(
    () =>
      validateWaivers({ waivers: [{ ...valid.waivers[0], expires: "2020-01-01" }] }, "2026-10-31"),
    /GHSA-example expired/,
  );
});

test("missing metadata and duplicate IDs fail", () => {
  assert.throws(
    () => validateWaivers({ waivers: [{ id: "X", expires: "2099-01-01" }] }),
    /needs reason/,
  );
  assert.throws(
    () => validateWaivers({ waivers: [valid.waivers[0], valid.waivers[0]] }),
    /Duplicate waiver/,
  );
});

test("audit keeps only high and critical advisory IDs", () => {
  const report = {
    advisories: {
      a: { id: 1, github_advisory_id: "GHSA-high", severity: "high" },
      b: { id: 2, severity: "moderate" },
      c: { id: 3, github_advisory_id: "GHSA-critical", severity: "critical" },
    },
  };
  assert.deepEqual(findingsFromAudit(report), ["GHSA-high", "GHSA-critical"]);
});

test("dependency review extracts high severity IDs", () => {
  const changes = [
    {
      vulnerabilities: [
        { advisory_ghsa_id: "GHSA-high", severity: "high" },
        { advisory_url: "https://github.com/advisories/GHSA-critical", severity: "critical" },
        { advisory_ghsa_id: "GHSA-low", severity: "low" },
      ],
    },
  ];
  assert.deepEqual(findingsFromDependencyReview(changes), ["GHSA-high", "GHSA-critical"]);
});

test("CodeQL SARIF gates only high security scores and errors", () => {
  const report = {
    runs: [
      {
        tool: {
          driver: {
            rules: [
              { id: "js/high", properties: { "security-severity": "8.2" } },
              { id: "js/low", properties: { "security-severity": "4.0" } },
            ],
          },
        },
        results: [
          { ruleId: "js/high" },
          { ruleId: "js/low" },
          { ruleId: "js/error", level: "error" },
        ],
      },
    ],
  };
  assert.deepEqual(findingsFromSarif(report), ["js/high", "js/error"]);
});

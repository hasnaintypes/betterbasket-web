import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import auditModule from "../dist/audit/audit.service.js";

const { AuditService, auditAction } = auditModule;

test("audit action mapping covers security routes and skips failed mutations", () => {
  const cases = [
    ["/sign-in/email", "sign_in.succeeded"],
    ["/change-password", "password.changed"],
    ["/admin/ban-user", "user.banned"],
    ["/admin/unban-user", "user.unbanned"],
    ["/admin/set-role", "user.role_changed"],
    ["/organization/remove-member", "organization.member_removed"],
    ["/organization/update-member-role", "organization.member_role_changed"],
    ["/organization/accept-invitation", "organization.invitation_accepted"],
  ];
  for (const [path, action] of cases) {
    assert.equal(auditAction(path, false), action);
    if (path !== "/sign-in/email") assert.equal(auditAction(path, true), null);
  }
  assert.equal(auditAction("/sign-in/email", true), "sign_in.failed");
  assert.equal(auditAction("/not-an-auth-action", false), null);
});

test("audit rows hash IPs and JSON-escape malicious fields without storing credentials", async () => {
  const rows = [];
  const salt = "test-only-independent-audit-salt-32-bytes";
  const audit = new AuditService(salt, async (row) => rows.push(row));
  const injectedId = 'user-1\n{"action":"forged"}';
  await audit.record({
    action: "sign_in.succeeded",
    actorType: "user",
    actorId: "user-1",
    targetType: "user",
    targetId: injectedId,
    ip: "203.0.113.5",
    details: { method: "email" },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ipHash, createHmac("sha256", salt).update("203.0.113.5").digest("hex"));
  assert.equal(rows[0].targetId, injectedId);
  assert.equal(JSON.stringify(rows[0]).split("\n").length, 1);
  assert.ok(JSON.stringify(rows[0]).includes("\\n"));
  assert.deepEqual(rows[0].details, { method: "email" });
  assert.ok(!JSON.stringify(rows[0].details).includes("@"));
});

test("audit write failures increment a metric and do not reject authentication", async () => {
  const before = auditModule.auditWriteFailuresTotal;
  const audit = new AuditService("test-only-independent-audit-salt-32-bytes", async () => {
    throw new Error("database unavailable");
  });
  await audit.record({ action: "sign_in.failed", actorType: "anonymous" });
  assert.equal(auditModule.auditWriteFailuresTotal, before + 1);
});

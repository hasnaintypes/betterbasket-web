import { createHmac } from "node:crypto";
import { createLogger } from "@betterbasket/logger";
import { auditLog } from "../db/schema.app";

const logger = createLogger({ service: "auth-service" });
type AuditRow = typeof auditLog.$inferInsert;

export type AuditAction =
  | "sign_in.succeeded"
  | "sign_in.failed"
  | "sign_out.succeeded"
  | "password.changed"
  | "password.reset"
  | "email.verified"
  | "user.banned"
  | "user.unbanned"
  | "user.role_changed"
  | "organization.member_added"
  | "organization.member_removed"
  | "organization.member_role_changed"
  | "organization.invitation_accepted"
  | "jwks.key_created"
  | "jwks.key_rotated";

const successfulActions: Record<string, AuditAction> = {
  "/change-password": "password.changed",
  "/admin/ban-user": "user.banned",
  "/admin/unban-user": "user.unbanned",
  "/admin/set-role": "user.role_changed",
  "/organization/remove-member": "organization.member_removed",
  "/organization/update-member-role": "organization.member_role_changed",
  "/organization/accept-invitation": "organization.invitation_accepted",
};

export function auditAction(path: string, failed: boolean): AuditAction | null {
  if (path === "/sign-in/email") return failed ? "sign_in.failed" : "sign_in.succeeded";
  return failed ? null : (successfulActions[path] ?? null);
}

export interface AuditEvent {
  action: AuditAction;
  actorId?: string | null;
  actorType: "user" | "anonymous" | "system";
  targetType?: "user" | "organization" | "jwks";
  targetId?: string | null;
  requestId?: string | null;
  ip?: string | null;
  // Only controlled flags are accepted. Request bodies, tokens, emails, and
  // user agents are never copied into audit details.
  details?: { method?: "email" | "session"; allowAdditional?: boolean };
}

export let auditWriteFailuresTotal = 0;

export function hashAuditIp(ip: string | null | undefined, salt: string): string | null {
  if (!ip) return null;
  return createHmac("sha256", salt).update(ip.trim()).digest("hex");
}

export class AuditService {
  constructor(
    private readonly salt: string,
    private readonly write: (row: AuditRow) => Promise<void>,
  ) {}

  async record(event: AuditEvent): Promise<void> {
    try {
      await this.write({
        actorId: event.actorId ?? null,
        actorType: event.actorType,
        action: event.action,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        requestId: event.requestId ?? null,
        ipHash: hashAuditIp(event.ip, this.salt),
        details: event.details ?? {},
      });
    } catch {
      auditWriteFailuresTotal += 1;
      logger.error(
        { action: event.action, audit_write_failures_total: auditWriteFailuresTotal },
        "audit write failed",
      );
    }
  }
}

/**
 * Structured audit logging. Never logs sensitive values (passwords, keys).
 * In production this writes rows to the audit_logs table; additional
 * transports (file, external SIEM) can be added later behind this interface.
 */
import { prisma } from "@/database/client";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login.failed"
  | "auth.logout"
  | "conversation.create"
  | "conversation.delete"
  | "message.send"
  | "api_key.create"
  | "api_key.delete"
  | "tool.execute"
  | "tool.denied"
  | "memory.create"
  | "memory.delete"
  | "project.create"
  | "document.upload"
  | "coding.workspace.create"
  | "coding.workspace.delete"
  | "coding.index"
  | "coding.plan"
  | "coding.change.propose"
  | "coding.change.apply"
  | "coding.change.reject"
  | "coding.restore"
  | "coding.command"
  | "coding.test"
  | "coding.git"
  | "security.rate_limited"
  | "security.validation_failed"
  | "research.start";

export interface AuditContext {
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function audit(action: AuditAction, ctx: AuditContext = {}, meta: Record<string, unknown> = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: ctx.userId ?? null,
        action,
        category: action.split(".")[0],
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        meta: JSON.stringify(meta),
      },
    });
  } catch {
    // Audit logging must never break the primary request flow.
  }
}

export function requestContext(headers: Headers): AuditContext {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = headers.get("user-agent");
  } catch {
    /* ignore */
  }
  return { ip, userAgent };
}
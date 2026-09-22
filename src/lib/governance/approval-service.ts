import { prisma } from "@/database/client";
import { audit, type AuditContext } from "@/security/audit";
import {
  createApprovalHash,
  verifyApprovalHash,
  type CanonicalAction,
  createCanonicalAction,
  createFileActionCanonical,
  createCommandActionCanonical,
  createBrowserActionCanonical,
  createDatabaseActionCanonical,
  createGitActionCanonical,
} from "@/lib/governance/approval-hash";
import { log } from "@/utils/log";

export type RiskLevel = "READ_ONLY" | "LOW_RISK" | "WRITE" | "COMMAND_EXECUTION" | "EXTERNAL_ACTION" | "HIGH_RISK";

export interface ApprovalRequestInput {
  userId: string;
  taskId?: string;
  nodeId?: string;
  agentId: string;
  toolId?: string;
  actionType: string;
  target: string;
  description: string;
  riskLevel: RiskLevel;
  exactAction: CanonicalAction;
  expiresInMs?: number;
}

export interface ApprovalResult {
  approvalId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
  expiresAt: Date;
  approvalHash: string;
}

export async function requestApproval(input: ApprovalRequestInput, ctx?: AuditContext): Promise<ApprovalResult> {
  const canonicalAction = input.exactAction;
  const approvalHash = createApprovalHash(canonicalAction);
  const expiresAt = new Date(Date.now() + (input.expiresInMs ?? 5 * 60 * 1000));

  const approval = await prisma.approvalRequest.create({
    data: {
      userId: input.userId,
      taskId: input.taskId ?? null,
      nodeId: input.nodeId ?? null,
      agentId: input.agentId,
      toolId: input.toolId ?? null,
      actionType: input.actionType,
      target: input.target,
      description: input.description,
      riskLevel: input.riskLevel,
      exactAction: JSON.stringify(canonicalAction),
      approvalHash,
      expiresAt,
      status: "PENDING",
    },
  });

  await audit("approval.requested", { userId: input.userId, ...ctx }, {
    approvalId: approval.id,
    actionType: input.actionType,
    target: input.target,
    riskLevel: input.riskLevel,
    taskId: input.taskId,
    nodeId: input.nodeId,
    agentId: input.agentId,
  });

  await prisma.approvalAudit.create({
    data: {
      userId: input.userId,
      approvalId: approval.id,
      actionType: input.actionType,
      target: input.target,
      riskLevel: input.riskLevel,
      event: "ACTION_REQUESTED",
      status: "PENDING",
      meta: JSON.stringify({ taskId: input.taskId, nodeId: input.nodeId, agentId: input.agentId, toolId: input.toolId }),
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    },
  });

  log.info("approval-created", { approvalId: approval.id, actionType: input.actionType, target: input.target });

  return {
    approvalId: approval.id,
    status: approval.status as ApprovalResult["status"],
    expiresAt: approval.expiresAt,
    approvalHash: approval.approvalHash,
  };
}

export async function checkApprovalStatus(approvalId: string, userId: string): Promise<ApprovalResult | null> {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
  });

  if (!approval) return null;
  if (approval.userId !== userId) return null;

  let status = approval.status as ApprovalResult["status"];
  if (status === "PENDING" && approval.expiresAt < new Date()) {
    status = "EXPIRED";
    await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: { status: "EXPIRED" },
    });
    await prisma.approvalAudit.create({
      data: {
        userId,
        approvalId,
        actionType: approval.actionType,
        target: approval.target,
        riskLevel: approval.riskLevel,
        event: "APPROVAL_EXPIRED",
        status: "EXPIRED",
      },
    });
  }

  return {
    approvalId: approval.id,
    status,
    expiresAt: approval.expiresAt,
    approvalHash: approval.approvalHash,
  };
}

export async function validateAndMarkExecuted(
  approvalId: string,
  userId: string,
  exactAction: CanonicalAction,
  ctx?: AuditContext
): Promise<{ ok: boolean; error?: string }> {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
  });

  if (!approval) {
    return { ok: false, error: "Approval not found" };
  }

  if (approval.userId !== userId) {
    return { ok: false, error: "Unauthorized" };
  }

  if (approval.expiresAt < new Date()) {
    await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: { status: "EXPIRED" },
    });
    return { ok: false, error: "Approval expired" };
  }

  if (approval.status !== "APPROVED") {
    return { ok: false, error: `Approval not approved (status: ${approval.status})` };
  }

  const isValid = verifyApprovalHash(approval.approvalHash, exactAction);
  if (!isValid) {
    await audit("approval.rejected", { userId, ...ctx }, {
      approvalId: approval.id,
      reason: "hash_mismatch",
      actionType: approval.actionType,
      target: approval.target,
    });

    await prisma.approvalAudit.create({
      data: {
        userId,
        approvalId: approval.id,
        actionType: approval.actionType,
        target: approval.target,
        riskLevel: approval.riskLevel,
        event: "ACTION_BLOCKED",
        status: "REJECTED",
        meta: JSON.stringify({ reason: "hash_mismatch" }),
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      },
    });

    return { ok: false, error: "Action does not match approved action (hash mismatch)" };
  }

  await audit("approval.approved", { userId, ...ctx }, {
    approvalId: approval.id,
    actionType: approval.actionType,
    target: approval.target,
    riskLevel: approval.riskLevel,
    taskId: approval.taskId,
    nodeId: approval.nodeId,
    verified: true,
  });

  await prisma.approvalAudit.create({
    data: {
      userId,
      approvalId: approval.id,
      actionType: approval.actionType,
      target: approval.target,
      riskLevel: approval.riskLevel,
      event: "ACTION_REVALIDATED",
      status: "APPROVED",
      meta: JSON.stringify({ taskId: approval.taskId, nodeId: approval.nodeId, verified: true }),
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    },
  });

  return { ok: true };
}

export async function markActionExecuted(
  approvalId: string,
  userId: string,
  ctx?: AuditContext
): Promise<void> {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
  });

  if (!approval) return;

  await prisma.approvalAudit.create({
    data: {
      userId,
      approvalId: approval.id,
      actionType: approval.actionType,
      target: approval.target,
      riskLevel: approval.riskLevel,
      event: "ACTION_EXECUTED",
      status: "EXECUTED",
      meta: JSON.stringify({ taskId: approval.taskId, nodeId: approval.nodeId }),
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    },
  });
}

export async function markActionBlocked(
  approvalId: string,
  userId: string,
  reason: string,
  ctx?: AuditContext
): Promise<void> {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
  });

  if (!approval) return;

  await prisma.approvalAudit.create({
    data: {
      userId,
      approvalId: approval.id,
      actionType: approval.actionType,
      target: approval.target,
      riskLevel: approval.riskLevel,
      event: "ACTION_BLOCKED",
      status: "BLOCKED",
      meta: JSON.stringify({ reason, taskId: approval.taskId, nodeId: approval.nodeId }),
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    },
  });
}

export async function cancelPendingApprovalsForTask(taskId: string, userId: string): Promise<void> {
  await prisma.approvalRequest.updateMany({
    where: { taskId, userId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
}

export async function expireOldApprovals(): Promise<number> {
  const result = await prisma.approvalRequest.updateMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

export {
  createApprovalHash,
  verifyApprovalHash,
  type CanonicalAction,
  createCanonicalAction,
  createFileActionCanonical,
  createCommandActionCanonical,
  createBrowserActionCanonical,
  createDatabaseActionCanonical,
  createGitActionCanonical,
};
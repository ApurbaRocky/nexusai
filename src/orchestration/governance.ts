import { prisma } from "@/database/client";
import { evaluateGovernance, verifyAndExecuteApproval, emergencyStop, type RiskLevel } from "@/lib/governance/policy-engine";
import { audit, type AuditContext } from "@/security/audit";
import type { AgentId } from "@/orchestration/types";
import type { CanonicalAction } from "@/lib/governance/approval-hash";

export type OrchestrationActionType =
  | "TASK_START"
  | "NODE_EXECUTE"
  | "TOOL_CALL"
  | "AGENT_MESSAGE"
  | "APPROVAL_REQUEST"
  | "TASK_COMPLETE"
  | "TASK_CANCEL"
  | "EMERGENCY_STOP";

const READ_ONLY_ORCHESTRATION = new Set(["TASK_START", "AGENT_MESSAGE", "TASK_COMPLETE"]);
const CONTROL_ORCHESTRATION = new Set(["NODE_EXECUTE", "TOOL_CALL", "APPROVAL_REQUEST", "TASK_CANCEL", "EMERGENCY_STOP"]);

function getRiskLevel(actionType: OrchestrationActionType): RiskLevel {
  if (actionType === "EMERGENCY_STOP") return "HIGH_RISK";
  if (actionType === "TASK_CANCEL") return "HIGH_RISK";
  if (CONTROL_ORCHESTRATION.has(actionType)) return "EXTERNAL_ACTION";
  return "READ_ONLY";
}

function requiresApproval(actionType: OrchestrationActionType): boolean {
  return CONTROL_ORCHESTRATION.has(actionType);
}

export interface OrchestrationActionRequest {
  taskId: string;
  nodeId?: string;
  userId: string;
  agentId: AgentId;
  actionType: OrchestrationActionType;
  target: string;
  description: string;
  nodeType?: string;
  toolName?: string;
  exactAction?: Record<string, unknown>;
}

export interface OrchestrationActionResult {
  allowed: boolean;
  requiresApproval: boolean;
  approvalId?: string;
  reason: string;
  ruleIds: string[];
}

export class OrchestrationGovernanceService {
  static async checkNodeExecution(
    request: OrchestrationActionRequest,
    ctx?: AuditContext
  ): Promise<OrchestrationActionResult> {
    const riskLevel = getRiskLevel(request.actionType);
    const needsApproval = requiresApproval(request.actionType);

    if (!needsApproval) {
      return {
        allowed: true,
        requiresApproval: false,
        reason: "Orchestration action allowed",
        ruleIds: ["RULE-USER-CONTROL-001"],
      };
    }

    const canonicalAction: CanonicalAction = {
      ...request.exactAction,
      actionType: request.actionType,
      target: request.target,
      nodeType: request.nodeType,
      toolName: request.toolName,
    };

    const governanceDecision = await evaluateGovernance({
      userId: request.userId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      agentId: request.agentId,
      toolId: request.toolName ?? `orchestration.${request.actionType.toLowerCase()}`,
      actionType: request.actionType,
      target: request.target,
      description: request.description,
      riskLevel,
      exactAction: canonicalAction,
    }, ctx);

    return {
      allowed: governanceDecision.allowed,
      requiresApproval: governanceDecision.requiresApproval,
      approvalId: governanceDecision.approvalId,
      reason: governanceDecision.reason,
      ruleIds: governanceDecision.ruleIds,
    };
  }

  static async executeApprovedNode(
    approvalId: string,
    userId: string,
    actionType: OrchestrationActionType,
    target: string,
    exactAction: Record<string, unknown>,
    ctx?: AuditContext
  ): Promise<{ ok: boolean; error?: string }> {
    const validation = await verifyAndExecuteApproval(approvalId, userId, {
      ...exactAction,
      actionType,
      target,
    }, ctx);
    return validation;
  }

  static async emergencyStopTask(userId: string, taskId: string): Promise<void> {
    await emergencyStop(userId, taskId);
  }

  static async cancelAllPendingApprovals(taskId: string, userId: string): Promise<void> {
    await prisma.approvalRequest.updateMany({
      where: { taskId, userId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    await audit("approval.cancelled", { userId }, {
      taskId,
      reason: "task_cancelled",
      event: "APPROVAL_CANCELLED",
    });
  }

  static isReadOnly(actionType: OrchestrationActionType): boolean {
    return READ_ONLY_ORCHESTRATION.has(actionType);
  }

  static isControl(actionType: OrchestrationActionType): boolean {
    return CONTROL_ORCHESTRATION.has(actionType);
  }

  static getRiskLevel(actionType: OrchestrationActionType): RiskLevel {
    return getRiskLevel(actionType);
  }
}

export async function auditOrchestrationAction(
  userId: string,
  actionType: OrchestrationActionType,
  target: string,
  success: boolean,
  ctx?: AuditContext,
  meta?: Record<string, unknown>
) {
  await audit("tool.execute", { userId, ...ctx }, {
    tool: `orchestration.${actionType.toLowerCase()}`,
    actionType,
    target,
    success,
    ...meta,
  });
}
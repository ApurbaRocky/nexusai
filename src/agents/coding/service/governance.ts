import { prisma } from "@/database/client";
import {
  evaluateGovernance,
  verifyAndExecuteApproval,
  createFileAction,
  createCommandAction,
  createGitAction,
  emergencyStop,
  type RiskLevel,
} from "@/lib/governance/policy-engine";
import type { CanonicalAction } from "@/lib/governance/approval-hash";
import { audit, type AuditContext } from "@/security/audit";

export type CodingActionType =
  | "READ_FILE"
  | "SEARCH_CODE"
  | "LIST_FILES"
  | "GET_ARCHITECTURE"
  | "CREATE_FILE"
  | "EDIT_FILE"
  | "DELETE_FILE"
  | "RENAME_FILE"
  | "MOVE_FILE"
  | "RUN_COMMAND"
  | "GIT_COMMIT"
  | "GIT_PUSH"
  | "GIT_RESET"
  | "GIT_REBASE"
  | "GIT_BRANCH_DELETE"
  | "GIT_FORCE_PUSH"
  | "INSTALL_DEPENDENCY"
  | "RUN_MIGRATION"
  | "DEPLOY"
  | "RUN_TESTS";

const READ_ONLY_CODING = new Set(["READ_FILE", "SEARCH_CODE", "LIST_FILES", "GET_ARCHITECTURE"]);
const DESTRUCTIVE_CODING = new Set(["DELETE_FILE", "GIT_RESET", "GIT_REBASE", "GIT_BRANCH_DELETE", "GIT_FORCE_PUSH", "RUN_MIGRATION", "DEPLOY"]);
const MODIFY_CODING = new Set(["CREATE_FILE", "EDIT_FILE", "RENAME_FILE", "MOVE_FILE"]);
const EXECUTE_CODING = new Set(["RUN_COMMAND", "INSTALL_DEPENDENCY", "RUN_TESTS"]);
const GIT_WRITE_CODING = new Set(["GIT_COMMIT", "GIT_PUSH"]);

function getRiskLevel(actionType: CodingActionType): RiskLevel {
  if (DESTRUCTIVE_CODING.has(actionType)) return "HIGH_RISK";
  if (EXECUTE_CODING.has(actionType) || GIT_WRITE_CODING.has(actionType)) return "COMMAND_EXECUTION";
  if (MODIFY_CODING.has(actionType)) return "WRITE";
  return "LOW_RISK";
}

function requiresApproval(actionType: CodingActionType): boolean {
  return !READ_ONLY_CODING.has(actionType);
}

export interface CodingActionRequest {
  workspaceId: string;
  taskId?: string;
  nodeId?: string;
  userId: string;
  agentId: string;
  actionType: CodingActionType;
  target: string;
  description: string;
  filePath?: string;
  oldContent?: string;
  newContent?: string;
  newPath?: string;
  command?: string;
  workingDirectory?: string;
  args?: string[];
  gitRef?: string;
  gitMessage?: string;
  exactAction?: Record<string, unknown>;
}

export interface CodingActionResult {
  approved: boolean;
  approvalId?: string;
  ruleIds?: string[];
  requiresApproval: boolean;
  reason: string;
  executed?: boolean;
  result?: unknown;
  error?: string;
}

export class CodingGovernanceService {
  static async requestAction(request: CodingActionRequest, ctx?: AuditContext): Promise<CodingActionResult> {
    const riskLevel = getRiskLevel(request.actionType);
    const needsApproval = requiresApproval(request.actionType);

    if (!needsApproval && riskLevel === "READ_ONLY") {
      return {
        approved: true,
        requiresApproval: false,
        ruleIds: ["RULE-USER-CONTROL-001"],
        reason: "Read-only coding action allowed",
      };
    }

    let canonicalAction: CanonicalAction;

    switch (request.actionType) {
      case "CREATE_FILE":
      case "EDIT_FILE":
      case "DELETE_FILE":
      case "RENAME_FILE":
      case "MOVE_FILE":
        canonicalAction = createFileAction(request.actionType.replace("_FILE", "") as "CREATE" | "EDIT" | "DELETE" | "RENAME" | "MOVE", request.filePath ?? request.target, {
          oldContent: request.oldContent,
          newContent: request.newContent,
          newPath: request.newPath,
        });
        break;
      case "RUN_COMMAND":
      case "INSTALL_DEPENDENCY":
      case "RUN_TESTS":
        canonicalAction = createCommandAction(
          request.command ?? request.target,
          request.workingDirectory ?? process.cwd(),
          request.args,
          {}
        );
        break;
      case "GIT_COMMIT":
      case "GIT_PUSH":
      case "GIT_RESET":
      case "GIT_REBASE":
      case "GIT_BRANCH_DELETE":
      case "GIT_FORCE_PUSH":
        canonicalAction = createGitAction(request.actionType.replace("GIT_", "") as "COMMIT" | "PUSH" | "RESET" | "REBASE" | "BRANCH_DELETE" | "FORCE_PUSH", request.gitRef ?? request.target, {
          message: request.gitMessage,
        });
        break;
      default:
        canonicalAction = {
          ...request.exactAction,
          actionType: request.actionType,
          target: request.target,
        };
    }

    const governanceDecision = await evaluateGovernance({
      userId: request.userId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      agentId: request.agentId,
      toolId: `coding.${request.actionType.toLowerCase()}`,
      actionType: request.actionType,
      target: request.target,
      description: request.description,
      riskLevel,
      exactAction: canonicalAction,
    }, ctx);

    if (!governanceDecision.requiresApproval) {
      return {
        approved: true,
        requiresApproval: false,
        ruleIds: governanceDecision.ruleIds,
        reason: governanceDecision.reason,
      };
    }

    return {
      approved: false,
      approvalId: governanceDecision.approvalId,
      requiresApproval: true,
      ruleIds: governanceDecision.ruleIds,
      reason: governanceDecision.reason,
    };
  }

  static async executeApprovedAction(
    approvalId: string,
    userId: string,
    actionType: CodingActionType,
    target: string,
    exactAction: Record<string, unknown>,
    ctx?: AuditContext
  ): Promise<CodingActionResult> {
    const canonicalAction: CanonicalAction = {
      ...exactAction,
      actionType,
      target,
    };
    const validation = await verifyAndExecuteApproval(approvalId, userId, canonicalAction, ctx);
    if (!validation.ok) {
      return {
        approved: false,
        approvalId,
        requiresApproval: false,
        reason: validation.error ?? "Validation failed",
        executed: false,
        error: validation.error,
      };
    }

    await prisma.approvalAudit.create({
      data: {
        userId,
        approvalId,
        actionType,
        target,
        riskLevel: getRiskLevel(actionType),
        event: "ACTION_EXECUTED",
        status: "EXECUTED",
        meta: JSON.stringify({ actionType, target }),
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      },
    });

    return {
      approved: true,
      approvalId,
      requiresApproval: false,
      reason: "Action executed after approval",
      executed: true,
    };
  }

  static async emergencyStopAll(userId: string, workspaceId?: string): Promise<void> {
    void workspaceId;
    await emergencyStop(userId, undefined);
  }

  static isReadOnly(actionType: CodingActionType): boolean {
    return READ_ONLY_CODING.has(actionType);
  }

  static isDestructive(actionType: CodingActionType): boolean {
    return DESTRUCTIVE_CODING.has(actionType);
  }

  static isModification(actionType: CodingActionType): boolean {
    return MODIFY_CODING.has(actionType);
  }

  static isExecution(actionType: CodingActionType): boolean {
    return EXECUTE_CODING.has(actionType);
  }

  static isGitWrite(actionType: CodingActionType): boolean {
    return GIT_WRITE_CODING.has(actionType);
  }

  static getRiskLevel(actionType: CodingActionType): RiskLevel {
    return getRiskLevel(actionType);
  }
}

export async function auditCodingAction(
  userId: string,
  actionType: CodingActionType,
  target: string,
  success: boolean,
  ctx?: AuditContext,
  meta?: Record<string, unknown>
) {
  await audit("tool.execute", { userId, ...ctx }, {
    tool: `coding.${actionType.toLowerCase()}`,
    actionType,
    target,
    success,
    ...meta,
  });
}
import { prisma } from "@/database/client";
import { requestApproval, validateAndMarkExecuted, markActionExecuted, markActionBlocked, cancelPendingApprovalsForTask, type ApprovalRequestInput, type RiskLevel } from "@/lib/governance/approval-service";
import {
  createFileActionCanonical,
  createCommandActionCanonical,
  createBrowserActionCanonical,
  createDatabaseActionCanonical,
  createGitActionCanonical,
  type CanonicalAction,
} from "@/lib/governance/approval-hash";
import { log } from "@/utils/log";
import type { AuditContext } from "@/security/audit";

export type { RiskLevel } from "@/lib/governance/approval-service";

export const GOVERNANCE_RULES = {
  "RULE-USER-CONTROL-001": {
    name: "Explicit User Approval Required for Destructive and Executable Actions",
    priority: "MAX_SAFE_PRIORITY",
    scope: "GLOBAL",
    enforcement: "SERVER_SIDE",
    overrideAllowed: false,
  },
  "RULE-USER-CONTROL-002": {
    name: "No Deletion Without Explicit Approval",
    priority: "MAX_SAFE_PRIORITY",
    scope: "GLOBAL",
    enforcement: "SERVER_SIDE",
    overrideAllowed: false,
  },
  "RULE-USER-CONTROL-003": {
    name: "No Command Execution Without Explicit Approval",
    priority: "MAX_SAFE_PRIORITY",
    scope: "GLOBAL",
    enforcement: "SERVER_SIDE",
    overrideAllowed: false,
  },
  "RULE-USER-CONTROL-004": {
    name: "No File Modification Without Explicit Approval",
    priority: "MAX_SAFE_PRIORITY",
    scope: "GLOBAL",
    enforcement: "SERVER_SIDE",
    overrideAllowed: false,
  },
} as const;

export type GovernanceRuleId = keyof typeof GOVERNANCE_RULES;

export interface GovernanceDecision {
  allowed: boolean;
  requiresApproval: boolean;
  approvalId?: string;
  ruleIds: GovernanceRuleId[];
  reason: string;
}

const DELETE_ACTIONS = new Set(["DELETE", "DROP", "TRUNCATE", "REMOVE", "UNLINK", "DESTROY"]);
const EXECUTE_ACTIONS = new Set(["EXECUTE", "RUN", "COMMAND", "SHELL", "SCRIPT"]);
const MODIFY_ACTIONS = new Set(["WRITE", "EDIT", "OVERWRITE", "RENAME", "MOVE", "REPLACE", "UPDATE", "MODIFY"]);
const SEND_ACTIONS = new Set(["SEND", "PUBLISH", "POST", "SUBMIT", "DEPLOY", "PUSH", "COMMIT"]);
const FINANCIAL_ACTIONS = new Set(["PURCHASE", "PAYMENT", "TRANSFER", "SUBSCRIPTION", "BILLING"]);
const SECURITY_ACTIONS = new Set(["PASSWORD_CHANGE", "2FA_CHANGE", "PERMISSION_CHANGE", "ROLE_CHANGE", "API_KEY_CREATE", "API_KEY_DELETE", "CREDENTIAL_ROTATION"]);

function classifyAction(actionType: string): { category: RiskLevel; rules: GovernanceRuleId[] } {
  const upper = actionType.toUpperCase();

  if (["READ", "READ_FILE", "SEARCH_CODE", "LIST_FILES", "GET_ARCHITECTURE"].includes(upper)) {
    return { category: "LOW_RISK", rules: ["RULE-USER-CONTROL-001"] };
  }

  if (DELETE_ACTIONS.has(upper) || upper.includes("DELETE")) {
    return { category: "HIGH_RISK", rules: ["RULE-USER-CONTROL-001", "RULE-USER-CONTROL-002"] };
  }
  if (EXECUTE_ACTIONS.has(upper) || upper.includes("COMMAND")) {
    return { category: "COMMAND_EXECUTION", rules: ["RULE-USER-CONTROL-001", "RULE-USER-CONTROL-003"] };
  }
  if (MODIFY_ACTIONS.has(upper) || upper.includes("FILE")) {
    return { category: "WRITE", rules: ["RULE-USER-CONTROL-001", "RULE-USER-CONTROL-004"] };
  }
  if (SEND_ACTIONS.has(upper)) {
    return { category: "EXTERNAL_ACTION", rules: ["RULE-USER-CONTROL-001"] };
  }
  if (FINANCIAL_ACTIONS.has(upper)) {
    return { category: "HIGH_RISK", rules: ["RULE-USER-CONTROL-001"] };
  }
  if (SECURITY_ACTIONS.has(upper)) {
    return { category: "HIGH_RISK", rules: ["RULE-USER-CONTROL-001"] };
  }

  return { category: "LOW_RISK", rules: ["RULE-USER-CONTROL-001"] };
}

export async function evaluateGovernance(
  input: ApprovalRequestInput & { exactAction: CanonicalAction },
  ctx?: AuditContext
): Promise<GovernanceDecision> {
  const { actionType } = input;
  const { category, rules } = classifyAction(actionType);

  if (category === "READ_ONLY" || category === "LOW_RISK") {
    return { allowed: true, requiresApproval: false, ruleIds: ["RULE-USER-CONTROL-001"], reason: "Read-only or low-risk action allowed" };
  }

  const approvalResult = await requestApproval({
    ...input,
    riskLevel: category,
  }, ctx);

  return {
    allowed: false,
    requiresApproval: true,
    approvalId: approvalResult.approvalId,
    ruleIds: rules,
    reason: `Action requires explicit user approval (${category})`,
  };
}

export async function verifyAndExecuteApproval(
  approvalId: string,
  userId: string,
  exactAction: CanonicalAction,
  ctx?: AuditContext
): Promise<{ ok: boolean; error?: string }> {
  const validation = await validateAndMarkExecuted(approvalId, userId, exactAction, ctx);
  if (!validation.ok) {
    await markActionBlocked(approvalId, userId, validation.error ?? "validation_failed", ctx);
    return validation;
  }

  await markActionExecuted(approvalId, userId, ctx);
  return { ok: true };
}

export function createFileAction(
  actionType: "CREATE" | "EDIT" | "DELETE" | "RENAME" | "MOVE",
  filePath: string,
  options: { oldContent?: string; newContent?: string; newPath?: string } = {}
): CanonicalAction {
  return createFileActionCanonical(actionType, filePath, options);
}

export function createCommandAction(
  command: string,
  workingDirectory: string,
  args: string[] = [],
  environmentScope: Record<string, string> = {}
): CanonicalAction {
  return createCommandActionCanonical(command, workingDirectory, args, environmentScope);
}

export function createBrowserAction(
  actionType: string,
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): CanonicalAction {
  return createBrowserActionCanonical(actionType, url, options);
}

export function createDatabaseAction(
  actionType: "DELETE" | "DROP" | "TRUNCATE" | "ALTER" | "BULK_UPDATE" | "BULK_DELETE",
  target: string,
  options: { query?: string; affectedCount?: number } = {}
): CanonicalAction {
  return createDatabaseActionCanonical(actionType, target, options);
}

export function createGitAction(
  actionType: "COMMIT" | "PUSH" | "RESET" | "REBASE" | "BRANCH_DELETE" | "FORCE_PUSH",
  target: string,
  options: { ref?: string; message?: string } = {}
): CanonicalAction {
  return createGitActionCanonical(actionType, target, options);
}

export async function emergencyStop(userId: string, taskId?: string): Promise<void> {
  if (taskId) {
    await cancelPendingApprovalsForTask(taskId, userId);
  } else {
    await prisma.approvalRequest.updateMany({
      where: { userId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: "approval.cancelled",
      category: "governance",
      meta: JSON.stringify({ reason: "emergency_stop", taskId }),
    },
  });

  log.warn("emergency-stop-triggered", { userId, taskId });
}

export function isProtectedAction(actionType: string): boolean {
  const upper = actionType.toUpperCase();
  return (
    DELETE_ACTIONS.has(upper) ||
    EXECUTE_ACTIONS.has(upper) ||
    MODIFY_ACTIONS.has(upper) ||
    SEND_ACTIONS.has(upper) ||
    FINANCIAL_ACTIONS.has(upper) ||
    SECURITY_ACTIONS.has(upper) ||
    upper.includes("COMMAND") ||
    upper.includes("DEPLOY") ||
    upper.includes("INSTALL")
  );
}

export function getActionCategory(actionType: string): RiskLevel {
  return classifyAction(actionType).category;
}
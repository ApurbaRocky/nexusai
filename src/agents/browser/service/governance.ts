import { prisma } from "@/database/client";
import { evaluateGovernance, verifyAndExecuteApproval, createBrowserAction, emergencyStop, type RiskLevel } from "@/lib/governance/policy-engine";
import { audit, type AuditContext } from "@/security/audit";

export type BrowserActionType =
  | "NAVIGATE"
  | "CLICK"
  | "TYPE"
  | "SELECT"
  | "SCROLL"
  | "OPEN_TAB"
  | "SWITCH_TAB"
  | "CLOSE_TAB"
  | "SCREENSHOT"
  | "EXTRACT"
  | "DOWNLOAD"
  | "UPLOAD"
  | "SUBMIT_FORM"
  | "AUTHENTICATE"
  | "PAYMENT"
  | "PURCHASE"
  | "SEND_MESSAGE"
  | "DELETE"
  | "PUBLISH"
  | "CHANGE_SETTING"
  | "READ"
  | "INSPECT";

const READ_ONLY_ACTIONS = new Set(["NAVIGATE", "SCROLL", "SCREENSHOT", "EXTRACT", "READ", "INSPECT", "OPEN_TAB", "SWITCH_TAB", "CLOSE_TAB", "WAIT"]);
const DESTRUCTIVE_ACTIONS = new Set(["DELETE", "SUBMIT_FORM", "SEND_MESSAGE", "PUBLISH", "PURCHASE", "PAYMENT", "CHANGE_SETTING", "AUTHENTICATE", "UPLOAD", "DOWNLOAD"]);

function getRiskLevel(actionType: BrowserActionType): RiskLevel {
  if (DESTRUCTIVE_ACTIONS.has(actionType)) return "HIGH_RISK";
  if (actionType === "CLICK" || actionType === "TYPE" || actionType === "SELECT") return "EXTERNAL_ACTION";
  return "READ_ONLY";
}

function requiresApproval(actionType: BrowserActionType): boolean {
  return !READ_ONLY_ACTIONS.has(actionType);
}

export interface BrowserActionRequest {
  sessionId: string;
  taskId?: string;
  nodeId?: string;
  userId: string;
  agentId: string;
  actionType: BrowserActionType;
  targetUrl: string;
  description: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  dataInvolved?: Record<string, unknown>;
  possibleConsequences?: string[];
  exactAction?: Record<string, unknown>;
}

export interface BrowserActionResult {
  approved: boolean;
  approvalId?: string;
  ruleIds?: string[];
  requiresApproval: boolean;
  reason: string;
  executed?: boolean;
  result?: unknown;
  error?: string;
}

export class BrowserGovernanceService {
  static async requestAction(request: BrowserActionRequest, ctx?: AuditContext): Promise<BrowserActionResult> {
    const riskLevel = getRiskLevel(request.actionType);
    const needsApproval = requiresApproval(request.actionType);

    if (!needsApproval && riskLevel === "READ_ONLY") {
      return {
        approved: true,
        requiresApproval: false,
        ruleIds: ["RULE-USER-CONTROL-001"],
        reason: "Read-only browser action allowed",
      };
    }

    const canonicalAction = createBrowserAction(request.actionType, request.targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      ...request.exactAction,
    });

    const governanceDecision = await evaluateGovernance({
      userId: request.userId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      agentId: request.agentId,
      toolId: `browser.${request.actionType.toLowerCase()}`,
      actionType: request.actionType,
      target: request.targetUrl,
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
    actionType: BrowserActionType,
    targetUrl: string,
    exactAction: Record<string, unknown>,
    ctx?: AuditContext
  ): Promise<BrowserActionResult> {
    const canonicalAction = createBrowserAction(actionType, targetUrl, exactAction);

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
        target: targetUrl,
        riskLevel: getRiskLevel(actionType),
        event: "ACTION_EXECUTED",
        status: "EXECUTED",
        meta: JSON.stringify({ actionType, targetUrl }),
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

  static async emergencyStopAll(userId: string): Promise<void> {
    await emergencyStop(userId, undefined);
  }

  static isReadOnly(actionType: BrowserActionType): boolean {
    return READ_ONLY_ACTIONS.has(actionType);
  }

  static isDestructive(actionType: BrowserActionType): boolean {
    return DESTRUCTIVE_ACTIONS.has(actionType);
  }

  static getRiskLevel(actionType: BrowserActionType): RiskLevel {
    return getRiskLevel(actionType);
  }
}

export async function auditBrowserAction(
  userId: string,
  actionType: BrowserActionType,
  targetUrl: string,
  success: boolean,
  ctx?: AuditContext,
  meta?: Record<string, unknown>
) {
  await audit("tool.execute", { userId, ...ctx }, {
    tool: `browser.${actionType.toLowerCase()}`,
    actionType,
    targetUrl,
    success,
    ...meta,
  });
}
/**
 * Phase 7 — Policy engine + approval model (spec §18, §26, §27).
 * Decisions are ALLOW / ALLOW_WITH_APPROVAL / DENY. No action happens without
 * the policy engine agreeing, and no action auto-runs in a require category
 * without an explicit human approval row.
 */
import type {
  ApprovalBehavior,
  ApprovalCategory,
  ApprovalStatus,
  AgentId,
  PolicyDecision,
  PolicyRuleInput,
  TaskType,
} from "@/orchestration/types";
import { APPROVAL_BEHAVIOR, approvalRank } from "@/orchestration/types";

export interface PolicyConfig {
  /** Users in these roles may auto-run LOW_RISK actions. */
  autoLowRiskRoles: string[];
  /** "always" | "ask" | "never" for LOW_RISK category. */
  lowRiskMode: "always" | "ask" | "never";
  /** Deny categories >= threshold for roles without privilege. admin role bypasses DENY except HIGH_RISK explicit. */
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  autoLowRiskRoles: ["admin", "owner"],
  lowRiskMode: "ask",
};

export const DENIED_AGENTS: Record<AgentId, readonly TaskType[]> = {
  general: [],
  research: [],
  education: [],
  security: ["testing"], // no exploit testing in Phase 7
  coding: ["user_approval", "testing"],
  document: [],
  rag: [],
  report: ["tool_execution"],
};

/** Sensitive/named tools that always require explicit approval. */
export const SENSITIVE_TOOLS = new Set([
  "git.commit",
  "git.push",
  "coding.apply_patch",
  "coding.delete_file",
  "shell",
]);

export function evaluatePolicy(input: PolicyRuleInput, config: PolicyConfig = DEFAULT_POLICY_CONFIG): PolicyDecision {
  // 1. Hard denials first.
  if (DENIED_AGENTS[input.agent]?.includes(input.taskType)) return "DENY";
  if (input.tool && SENSITIVE_TOOLS.has(input.tool)) {
    return input.approvalCategory === "HIGH_RISK" ? "DENY" : "ALLOW_WITH_APPROVAL";
  }

  // 2. Risk -> behavior mapping.
  const behavior: ApprovalBehavior = APPROVAL_BEHAVIOR[input.approvalCategory] ?? "require";

  if (behavior === "auto") return "ALLOW";

  if (behavior === "configurable" /* LOW_RISK */) {
    const isAdmin = (input.role ?? "").toLowerCase() === "admin" || (input.role ?? "").toLowerCase() === "owner";
    if (config.lowRiskMode === "always") return "ALLOW";
    if (config.lowRiskMode === "never") return "DENY";
    // "ask": admins auto-approve LOW_RISK, everyone else gets a request.
    return isAdmin ? "ALLOW" : "ALLOW_WITH_APPROVAL";
  }

  // WRITE / COMMAND_EXECUTION / EXTERNAL_ACTION / HIGH_RISK
  if (input.approvalCategory === "HIGH_RISK") return "ALLOW_WITH_APPROVAL";
  return "ALLOW_WITH_APPROVAL";
}

export interface ShouldAskForApprovalInput {
  category: ApprovalCategory;
  role?: string;
  previousStatus?: ApprovalStatus;
}

/** Upgrade to a user question instead of a silent approval when ambiguous. */
export function shouldAskInsteadOfApproval(input: ShouldAskForApprovalInput): boolean {
  if (input.previousStatus === "rejected") return true;
  return approvalRank(input.category) >= approvalRank("EXTERNAL_ACTION");
}

export interface ApprovalDecisionContext {
  decision: PolicyDecision;
  requireApproval: boolean;
  category: ApprovalCategory;
  reason: string;
}

export function decideApproval(input: PolicyRuleInput, config: PolicyConfig = DEFAULT_POLICY_CONFIG): ApprovalDecisionContext {
  const decision = evaluatePolicy(input, config);
  if (decision === "DENY") {
    return { decision, requireApproval: false, category: input.approvalCategory, reason: "Denied by policy" };
  }
  if (decision === "ALLOW") {
    return { decision, requireApproval: false, category: input.approvalCategory, reason: "Auto-allowed by policy" };
  }
  return {
    decision,
    requireApproval: true,
    category: input.approvalCategory,
    reason: `Approval required for category ${input.approvalCategory}`,
  };
}

/**
 * Loop / runaway detection for the executor. Returns the number of times a
 * node has run this task when > 0, so the executor can raise an alert.
 */
export function detectLoops(runHistory: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of runHistory) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

export function isRunaway(history: string[], maxRuns: number): boolean {
  return Array.from(detectLoops(history).values()).some((count) => count > maxRuns);
}
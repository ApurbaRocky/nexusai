/**
 * Phase 7 — Orchestration domain types.
 * Pure data types shared across the orchestration layer. No IO here so the
 * state machine, planner, routers and budgets stay unit-testable.
 */

export type TaskStatus =
  | "draft"
  | "planning"
  | "ready"
  | "running"
  | "waiting"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type NodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "retrying"
  | "blocked";

export type TaskType =
  | "analysis"
  | "research"
  | "document_analysis"
  | "code_analysis"
  | "security_analysis"
  | "education"
  | "rag"
  | "generation"
  | "transformation"
  | "validation"
  | "testing"
  | "reporting"
  | "tool_execution"
  | "user_approval";

export type AgentId = "general" | "research" | "education" | "security" | "coding" | "document" | "rag" | "report";

export type ApprovalCategory = "READ_ONLY" | "LOW_RISK" | "WRITE" | "COMMAND_EXECUTION" | "EXTERNAL_ACTION" | "HIGH_RISK";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ApprovalBehavior = "auto" | "configurable" | "require";

export const APPROVAL_BEHAVIOR: Record<ApprovalCategory, ApprovalBehavior> = {
  READ_ONLY: "auto",
  LOW_RISK: "configurable",
  WRITE: "require",
  COMMAND_EXECUTION: "require",
  EXTERNAL_ACTION: "require",
  HIGH_RISK: "require",
};

export const APPROVAL_ORDER: ApprovalCategory[] = [
  "READ_ONLY",
  "LOW_RISK",
  "WRITE",
  "COMMAND_EXECUTION",
  "EXTERNAL_ACTION",
  "HIGH_RISK",
];

export function approvalRank(category: ApprovalCategory): number {
  return APPROVAL_ORDER.indexOf(category);
}

export type AgentMessageType =
  | "REQUEST"
  | "RESPONSE"
  | "QUESTION"
  | "RESULT"
  | "WARNING"
  | "ERROR"
  | "HANDOFF"
  | "VALIDATION"
  | "APPROVAL_REQUIRED";

export type ConfidenceLabel = "Confirmed" | "Likely" | "Uncertain" | "Conflicting Evidence" | "Requires Verification";

export interface AgentResult {
  success: boolean;
  summary: string;
  findings?: unknown[];
  evidence?: string[];
  artifacts?: { artifactType: string; title: string; body?: string; refId?: string }[];
  citations?: { title: string; url: string; verified?: boolean }[];
  recommendations?: string[];
  confidence?: ConfidenceLabel;
  nextActions?: string[];
  error?: string;
  usage?: { provider?: string; model?: string; promptTokens?: number; completionTokens?: number };
}

export interface PlanStep {
  id: string;
  title: string;
  type: TaskType;
  agent: AgentId;
  description?: string;
  dependsOn?: string[];
  inputs?: Record<string, unknown>;
  timeoutMs?: number;
  maxRetries?: number;
  approval?: ApprovalCategory;
  expectedOutput?: string;
}

export interface TaskPlan {
  goal: string;
  summary: string;
  steps: PlanStep[];
  agents: AgentId[];
  estimatedSteps: number;
  risk: ApprovalCategory;
  externalSearch: boolean;
  fileModification: boolean;
  autoStart: boolean;
  permissionsNote: string;
}

export interface NodeInput {
  /** Raw text/directive for the node. */
  text?: string;
  /** References { artifactId | taskRunId | nodeId }. */
  refs?: string[];
  /** Uploaded documents to consult. */
  documentIds?: string[];
  /** Coding workspace to analyze. */
  codingWorkspaceId?: string;
  /** Key/value extras. */
  extras?: Record<string, unknown>;
}

export interface BudgetLimits {
  maxTokens?: number;
  maxCostUsd?: number;
  maxRuntimeMs?: number;
  maxAgentCalls?: number;
  maxToolCalls?: number;
  maxFilesModified?: number;
  maxCommands?: number;
}

export interface BudgetUsage {
  tokens: number;
  costUsd: number | null;
  costEstimated: boolean;
  agentCalls: number;
  toolCalls: number;
  filesModified: number;
  commands: number;
  runtimeMs: number;
}

export interface FinalReport {
  summary: string;
  whatWasDone: string[];
  importantFindings: string[];
  artifacts: { id: string; title: string; artifactType: string; refId?: string }[];
  unresolvedIssues: string[];
  sources: { title: string; url: string; verified?: boolean }[];
  nextActions: string[];
  incomplete: string[];
}

export interface TaskEventTypeDef {
  type: string;
  message: string;
  meta?: Record<string, unknown>;
}

export const EVENT = {
  TASK_CREATED: "TASK_CREATED",
  PLAN_CREATED: "PLAN_CREATED",
  TASK_STARTED: "TASK_STARTED",
  NODE_STARTED: "NODE_STARTED",
  NODE_COMPLETED: "NODE_COMPLETED",
  NODE_FAILED: "NODE_FAILED",
  NODE_RETRYING: "TASK_RETRYING",
  AGENT_SELECTED: "AGENT_SELECTED",
  TOOL_STARTED: "TOOL_STARTED",
  TOOL_COMPLETED: "TOOL_COMPLETED",
  AGENT_MESSAGE: "AGENT_MESSAGE",
  TASK_PROGRESS: "TASK_PROGRESS",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  ARTIFACT_CREATED: "ARTIFACT_CREATED",
  TASK_COMPLETED: "TASK_COMPLETED",
  TASK_FAILED: "TASK_FAILED",
  TASK_CANCELLED: "TASK_CANCELLED",
  USER_ANSWERED: "USER_ANSWERED",
  MEMORY_ADDED: "MEMORY_ADDED",
  CHECKPOINT: "CHECKPOINT",
} as const;

export interface TaskSummary {
  id: string;
  title: string;
  goal: string;
  status: TaskStatus;
  risk: ApprovalCategory;
  priority: string;
  progress: number;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string | null;
}

export interface NodeDetail {
  id: string;
  taskId: string;
  parentId?: string | null;
  type: TaskType;
  agent: AgentId;
  title: string;
  status: NodeStatus;
  priority: number;
  order: number;
  dependencies: string[];
  inputs?: Record<string, unknown>;
  outputs?: AgentResult | null;
  error?: string | null;
  retries: number;
  maxRetries: number;
  startedAt?: string | null;
  completedAt?: string | null;
}

/** Decoded orchestration task as returned by the API. */
export interface TaskDetail {
  id: string;
  title: string;
  goal: string;
  status: TaskStatus;
  risk: ApprovalCategory;
  priority: string;
  progress: number;
  plan?: TaskPlan | null;
  input?: string | null;
  budget?: BudgetLimits | null;
  budgetUsage?: BudgetUsage | null;
  result?: FinalReport | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  nodes: NodeDetail[];
  events: { id: string; type: string; message: string; nodeId?: string | null; createdAt: string }[];
  messages: { id: string; senderAgent: string; receiverAgent: string; messageType: AgentMessageType; payload: Record<string, unknown>; createdAt: string }[];
  approvals: {
    id: string;
    category: ApprovalCategory;
    status: ApprovalStatus;
    reason: string;
    requestedBy: string;
    askedAt: string;
    decidedAt?: string | null;
    meta?: Record<string, unknown> | null;
  }[];
  artifacts: {
    id: string;
    artifactType: string;
    title: string;
    summary: string;
    body?: string | null;
    refId?: string | null;
    creatorAgent: string;
    createdAt: string;
  }[];
  memories: { id: string; kind: string; content: string; createdAt: string }[];
  checkpoints: { id: string; label: string; createdAt: string }[];
  questions: { id: string; question: string; options: string[]; status: string; answer?: string | null; askedAt: string }[];
  runs: {
    id: string;
    kind: string;
    agent?: string | null;
    tool?: string | null;
    provider?: string | null;
    model?: string | null;
    status: string;
    ok?: boolean | null;
    totalTokens?: number | null;
    costUsd?: number | null;
    costEstimated: boolean;
    durationMs?: number | null;
    error?: string | null;
    createdAt: string;
  }[];
}

/** Policy decision returned by ExecutionPolicy. */
export type PolicyDecision = "ALLOW" | "ALLOW_WITH_APPROVAL" | "DENY";

export interface PolicyRuleInput {
  userId: string;
  role?: string;
  taskId?: string;
  agent: AgentId;
  taskType: TaskType;
  tool?: string;
  target?: string;
  approvalCategory: ApprovalCategory;
}

export interface OllamaRoute {
  agent: AgentId;
  confidence: number;
  reason: string[];
  requiredContext: string[];
}
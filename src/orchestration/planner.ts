/**
 * Phase 7 — Planner + decomposer (spec §4, §14, §15).
 * Converts a user goal into a validated TaskPlan: ordered steps with typed
 * agents and strict dependency edges. Purely deterministic — no provider
 * needed; an LLM refinement pass can be layered on later.
 */
import type { AgentId, ApprovalCategory, PlanStep, TaskPlan, TaskType } from "@/orchestration/types";
import { APPROVAL_BEHAVIOR } from "@/orchestration/types";

export interface PlanConfig {
  hasAttachments?: boolean;
  researchMode?: boolean;
  projectId?: string | null;
  documentIds?: string[];
  codingWorkspaceId?: string | null;
  externalSearchHint?: boolean;
}

export interface PlanRequest {
  goal: string;
  config?: PlanConfig;
}

export interface PlanValidation {
  valid: boolean;
  errors: string[];
}

export function validatePlan(plan: TaskPlan): PlanValidation {
  const errors: string[] = [];
  if (!plan.goal.trim()) errors.push("Goal is empty");
  if (!plan.steps.length) errors.push("Plan has no steps");
  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (ids.has(step.id)) errors.push(`Duplicate step id ${step.id}`);
    ids.add(step.id);
    if ((step.dependsOn ?? []).some((d) => d === step.id)) errors.push(`Step ${step.id} depends on itself`);
    if (!["research", "education", "security", "coding", "document", "rag", "report", "general"].includes(step.agent)) {
      errors.push(`Unknown agent ${step.agent}`);
    }
  }
  for (const step of plan.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!ids.has(dep)) errors.push(`Step ${step.id} depends on missing ${dep}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Assemble a plan's overall risk from its steps, normalized to the category ceiling. */
export function planRisk(plan: TaskPlan): ApprovalCategory {
  const rank = { READ_ONLY: 0, LOW_RISK: 1, WRITE: 2, COMMAND_EXECUTION: 3, EXTERNAL_ACTION: 4, HIGH_RISK: 5 };
  let max = 0;
  for (const step of plan.steps) if (step.approval) max = Math.max(max, rank[step.approval]);
  const order: ApprovalCategory[] = ["READ_ONLY", "LOW_RISK", "WRITE", "COMMAND_EXECUTION", "EXTERNAL_ACTION", "HIGH_RISK"];
  return order[max] ?? "READ_ONLY";
}

export function planRequiresApproval(plan: TaskPlan): { category: ApprovalCategory; steps: PlanStep[] }[] {
  return plan.steps
    .filter((s) => s.approval && APPROVAL_BEHAVIOR[s.approval] !== "auto")
    .map((s) => ({ category: s.approval as ApprovalCategory, steps: [s] }));
}

let seq = 0;
function sid(step: TaskType, tag = ""): string {
  seq += 1;
  return `${step}_${seq}${tag}`;
}

const RESEARCH_HINTS = ["research", "latest", "sources", "look up", "find information", "compare sources", "citations", "deep research", "report"];
const EDU_HINTS = ["explain", "teach", "learn", "study", "exam", "quiz", "viva", "flashcard", "study guide"];
const CODE_HINTS = ["code", "bug", "debug", "refactor", "implement", "function", "repository", "workspace", "api", "typescript", "python", "test"];
const SEC_HINTS = ["security", "vulnerab", "injection", "xss", "csrf", "owasp", "audit", "threat"];
const DOC_HINTS = ["document", "pdf", "file", "attach", "upload", "paper"];

function has(text: string, hints: string[]): boolean {
  return hints.some((h) => text.toLowerCase().includes(h));
}

/**
 * Deterministic planner — turns the goal into a dependency graph.
 * Compose route: if the request needs multiple dimensions, we add parallel spy
 * nodes and serial validation/synthesis nodes after them.
 */
export function planRequest(request: PlanRequest): TaskPlan {
  const goal = request.goal.trim();
  const cfg = request.config ?? {};

  const wantsResearch = cfg.researchMode || has(goal, RESEARCH_HINTS);
  const wantsEducation = has(goal, EDU_HINTS);
  const wantsCode = has(goal, CODE_HINTS) || Boolean(cfg.codingWorkspaceId);
  const wantsDocs = Boolean(cfg.documentIds?.length) || cfg.hasAttachments || has(goal, DOC_HINTS);
  const wantsSecurity = has(goal, SEC_HINTS);

  const steps: PlanStep[] = [];
  const summary: string[] = [];
  const agents = new Set<AgentId>();
  const usedBefore: AgentId[] = [];

  const add = (step: PlanStep) => {
    steps.push(step);
    agents.add(step.agent);
    if (!usedBefore.includes(step.agent)) usedBefore.push(step.agent);
  };

  // 1. Always: understand/context node (grounds the task, cheap, no approvals).
  add({
    id: sid("analysis"),
    title: "Understand the objective",
    type: "analysis",
    agent: "general",
    description: "Parse the goal, extract constraints, keywords and required context.",
    expectedOutput: "Task understanding: constraints + keywords + context requirements",
  });

  // 2. Parallel evidence-gathering nodes depending on intent.
  const firstEcho = steps[0];
  const evidence: string[] = [];

  if (wantsDocs) {
    const id = sid("document_analysis");
    add({
      id,
      title: "Analyze documents",
      type: "document_analysis",
      agent: "document",
      description: "Extract + summarize + question the uploaded documents.",
      dependsOn: [firstEcho.id],
      inputs: { mode: "analyze_and_summarize" },
      expectedOutput: "Document findings + citations to sources",
    });
    add({
      id: sid("rag", "_retrieval"),
      title: "Retrieve grounded context",
      type: "rag",
      agent: "rag",
      description: "Pull relevant passages from the document store with citations.",
      dependsOn: [firstEcho.id],
      inputs: { topK: 4 },
      expectedOutput: "Cited document passages",
    });
    evidence.push(id);
  }

  if (wantsResearch) {
    const id = sid("research");
    add({
      id,
      title: "Perform web research",
      type: "research",
      agent: "research",
      description: "Search the web, read sources, compare and cite them.",
      dependsOn: evidence.length ? [firstEcho.id] : [firstEcho.id],
      inputs: { mode: "search_compare_cite" },
      expectedOutput: "Verified findings with citations",
    });
    evidence.push(id);
  }

  if (wantsEducation) {
    const id = sid("education");
    add({
      id,
      title: "Teach / explain the topic",
      type: "education",
      agent: "education",
      description: "Explain the concept clearly (exam-ready framing if requested).",
      dependsOn: [firstEcho.id],
      inputs: {},
      expectedOutput: "Explanation with examples",
    });
    evidence.push(id);
  }

  if (wantsCode) {
    const id = sid("code_analysis");
    add({
      id,
      title: "Analyze codebase",
      type: "code_analysis",
      agent: "coding",
      description: "Inspect the relevant code and identify the root cause.",
      dependsOn: [firstEcho.id],
      inputs: { codingWorkspaceId: cfg.codingWorkspaceId ?? null, mode: "analyze" },
      expectedOutput: "Root-cause analysis + affected files",
    });
    evidence.push(id);
  }

  if (wantsSecurity && wantsCode) {
    const id = sid("security_analysis");
    add({
      id,
      title: "Security review",
      type: "security_analysis",
      agent: "security",
      description: "Review the affected code for OWASP/CWE class issues.",
      dependsOn: evidence.length ? [evidence[evidence.length - 1]] : [firstEcho.id],
      inputs: {},
      expectedOutput: "Prioritized security findings",
    });
    evidence.push(id);
  }

  // 3. If nothing was needed beyond understanding, still produce an answer node.
  if (!evidence.length) {
    const id = sid("generation");
    add({
      id,
      title: "Answer the user",
      type: "generation",
      agent: "general",
      description: "Directly answer the request, honestly flagging when more context is needed.",
      dependsOn: [firstEcho.id],
      inputs: {},
      expectedOutput: "Direct answer",
    });
    evidence.push(id);
  }

  // 4. Validation node (self-check) over the evidence.
  const validationId = sid("validation");
  add({
    id: validationId,
    title: "Validate & verify",
    type: "validation",
    agent: "general",
    description: "Cross-check findings for consistency, gaps and contradictions.",
    dependsOn: [...evidence],
    expectedOutput: "Validation verdict + unresolved issues",
  });

  // 5. Reporting node — always the sink, aggregates node Artifacts into the
  //    final structured report (Phase 7 deliverable).
  add({
    id: sid("reporting"),
    title: "Produce final report",
    type: "reporting",
    agent: "report",
    description: "Synthesize all node outputs and artifacts into the final report.",
    dependsOn: [validationId],
    expectedOutput: "Final report",
  });

  summary.push(...usedBefore.map((a) => `Agent(s): ${a}`));
  const externalSearch = wantsResearch;
  const fileModification = wantsCode;
  const risk = planRisk({ goal, summary: summary.join("\n"), steps, agents: [...agents], estimatedSteps: steps.length, risk: "READ_ONLY", externalSearch, fileModification, autoStart: true, permissionsNote: "" });

  return {
    goal,
    summary: summary.join("\n"),
    steps,
    agents: [...agents],
    estimatedSteps: steps.length,
    risk,
    externalSearch,
    fileModification,
    autoStart: true,
    permissionsNote: risk === "READ_ONLY" ? "No external actions required." : "One or more steps require approval before they can run.",
  };
}

/** Depth of a node within the dependency graph (longest path to every root). */
export function nodeDepth(plan: TaskPlan, stepId: string): number {
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step || !step.dependsOn?.length) return 0;
  return 1 + Math.max(...step.dependsOn.map((d) => nodeDepth(plan, d)));
}

export function maxPlanDepth(plan: TaskPlan): number {
  return Math.max(0, ...plan.steps.map((s) => nodeDepth(plan, s.id)));
}

/** Topological order of steps (stable). */
export function topologicalOrder(plan: TaskPlan): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const step = plan.steps.find((s) => s.id === id);
    for (const dep of step?.dependsOn ?? []) visit(dep);
    order.push(id);
  };
  // Visit in declaration order to keep the plan's stable ordering.
  for (const step of plan.steps) visit(step.id);
  return order;
}
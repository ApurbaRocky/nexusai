/**
 * Agent registry and intent classifier (spec §5 Orchestrator, §13 Registry).
 * The classifier is heuristic-first (works with zero provider keys); an LLM
 * based planner is an integration point (src/agents/orchestrator/planner.ts).
 */
import type { AgentDefinition, AgentId, PlanStep, PlanningResult } from "@/agents/types";
import { ASSISTANT_AGENT, CODING_AGENT, DOCUMENT_AGENT, EDUCATION_AGENT, RESEARCH_AGENT, SECURITY_AGENT } from "@/agents/agents/definitions";

const AGENTS: Record<AgentId, AgentDefinition> = {
  assistant: ASSISTANT_AGENT,
  research: RESEARCH_AGENT,
  education: EDUCATION_AGENT,
  security: SECURITY_AGENT,
  coding: CODING_AGENT,
  document: DOCUMENT_AGENT,
};

export const AGENT_ORDER: AgentId[] = ["assistant", "research", "education", "security", "coding", "document"];

export function getAgent(id: AgentId | string | null | undefined): AgentDefinition {
  if (id && id in AGENTS) return AGENTS[id as AgentId];
  return AGENTS.assistant;
}

export function listAgents(): AgentDefinition[] {
  return AGENT_ORDER.map((id) => AGENTS[id]);
}

// ---------------------------------------------------------------------------
// Heuristic classifier. Safe default: assistant.
// ---------------------------------------------------------------------------

const RESEARCH_HINTS = ["research", "literature review", "literature survey", "cite", "citations", "sources for", "compare sources", "find information about", "deep research", "write a report on", "rapport", "report on", "analysis of", "compare", "comparison", "overview of", "state of the art", "benchmark", "what are the latest", "রিপোর্ট", "গবেষণা"];
const EDUCATION_HINTS = ["explain", "teach", "learn", "study", "exam", "mcq", "question", "viva", "flashcard", "flash card", "explain for 5 marks", "explain for 10 marks", "exam-ready", "homework", "4th", "5th", "subject", "chapter", "class-", "class ", "mark answer", "ব্যাখ্যা", "পড়াশোনা", "পরীক্ষা", "quiz", "flashcard", "study plan", "evaluate", "practice"];
const SECURITY_HINTS = ["owasp", "injection", "xss", "csrf", "security header", "vulnerability", "secure code", "penetration", "security review", "authorization", "authentication review", "remediation", "cyber", "রক্ষা", "সিকিউরিটি", "firewall", "cve", "audit my api", "threat", "malware"];
const CODING_HINTS = ["debug", "refactor", "unit test", "write code", "generate code", "code review", "golang", "python", "javascript", "typescript", "react", "api design", "architecture", "implement", "fix bug", "bug in", "프로그램", "কোড"];
const DOCUMENT_HINTS = ["summarize this file", "summarize the file", "this document", "attached document", "uploaded file", "this pdf", "pdf", "file contents", "the document", "in this file", "compare documents", "read the file"];

function hintTrigger(text: string, hints: string[]): boolean {
  const lower = text.toLowerCase();
  return hints.some((h) => lower.includes(h));
}

export interface ClassifyOptions {
  explicitAgent?: string | null;
  hasAttachments?: boolean;
  researchModeEnabled?: boolean;
  projectId?: string | null;
}

export function classifyRequest(content: string, options: ClassifyOptions = {}): PlanningResult {
  if (options.explicitAgent && options.explicitAgent in AGENTS) {
    return buildResult(options.explicitAgent as AgentId, ["Explicit agent selected"]);
  }

  const hasAttachment = options.hasAttachments ?? false;
  const researchMode = options.researchModeEnabled ?? false;

  let agent: AgentId = "assistant";
  const rationale: string[] = [];

  // Research mode toggle or explicit research phrasing -> research agent.
  if (researchMode || hintTrigger(content, RESEARCH_HINTS)) {
    agent = "research";
    rationale.push("Research intent detected");
  } else if (hintTrigger(content, EDUCATION_HINTS)) {
    agent = "education";
    rationale.push("Education/exam intent detected");
  } else if (hintTrigger(content, SECURITY_HINTS)) {
    agent = "security";
    rationale.push("Defensive-security intent detected");
  } else if (hintTrigger(content, CODING_HINTS)) {
    agent = "coding";
    rationale.push("Coding intent detected");
  } else if (hasAttachment || hintTrigger(content, DOCUMENT_HINTS)) {
    agent = "document";
    rationale.push("Document query detected");
  }

  return buildResult(agent, rationale);
}

function buildResult(agentId: AgentId, rationale: string[]): PlanningResult {
  const agent = getAgent(agentId);
  const plan: PlanStep[] = [
    { id: "understand", title: "Understand the objective", done: true },
    { id: "breakdown", title: "Break the objective into tasks", done: true },
  ];
  if (agent.toolPlanning) {
    plan.push({ id: "tools", title: `Select tools (${agent.allowedTools.join(", ")})` });
    plan.push({ id: "execute", title: "Execute tools" });
  }
  plan.push({ id: "synthesize", title: "Synthesize results into a final answer" });
  if (agentId === "research") plan.push({ id: "cite", title: "Attach sources & citations" });

  return {
    agentId,
    rationale,
    plan,
    useTools: agent.toolPlanning,
    researchMode: agentId === "research",
  };
}

export { AGENTS };
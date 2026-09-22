/**
 * Phase 7 — Agent + Tool routing (spec §9, §10, §42).
 * Heuristic-first, deterministic, and works without provider keys. The
 * orchestrator requests a route bundle (multiple agents + tool needs) rather
 * than a single label, so collaborative workflows emerge from intent.
 */
import type { AgentId, OllamaRoute, TaskType } from "@/orchestration/types";
import { classifyRequest } from "@/agents/agents/registry";
import { buildRagContextBlock } from "@/rag/service";

export interface RouteRequest {
  text: string;
  hasAttachments?: boolean;
  researchMode?: boolean;
  projectId?: string | null;
  hasDocuments?: boolean;
  hasCodingWorkspace?: boolean;
}

export interface ToolNeed {
  name: string;
  reason: string;
  permissions: "auto" | "confirm";
}

export interface RoutingDecision {
  agents: { agent: AgentId; confidence: number; reason: string[]; taskType: TaskType }[];
  tools: ToolNeed[];
  primary: AgentId;
  multiAgent: boolean;
}

const RESEARCH_HINTS = ["research", "latest", "sources for", "look up", "find information", "compare sources", "citations", "deep research", "report on", "what are the latest"];
const EDUCATION_HINTS = ["explain", "teach", "learn", "study", "exam", "quiz", "flashcard", "viva", "study guide", "explain for"];
const DOCUMENT_HINTS = ["pdf", "document", "uploaded file", "this file", "attached", "my notes", "paper", "analyze my"];
const SECURITY_HINTS = ["security", "owasp", "vulnerab", "injection", "xss", "csrf", "secure code", "threat", "audit", "risk"];
const CODING_HINTS = ["code", "bug", "debug", "refactor", "implement", "function", "repository", "workspace", "api", "typescript", "python", "react", "test"];
const REPORT_HINTS = ["report", "summary", "summarize", "final report", "write up", "produce a report"];

function hint(text: string, hints: string[]): boolean {
  const lower = text.toLowerCase();
  return hints.some((h) => lower.includes(h));
}

/** Route a user request into a collaborative bundle of agents. */
export function routeRequest(req: RouteRequest): RoutingDecision {
  const text = req.text;
  const agents: RoutingDecision["agents"] = [];
  const tools: ToolNeed[] = [];

  const primary = hint(text, RESEARCH_HINTS)
    ? "research"
    : hint(text, EDUCATION_HINTS)
      ? "education"
      : hint(text, SECURITY_HINTS)
        ? "security"
        : hint(text, CODING_HINTS)
          ? "coding"
          : hint(text, REPORT_HINTS)
            ? "report"
            : "general";

  // Document dimension.
  const needsDocs = req.hasAttachments || req.hasDocuments || hint(text, DOCUMENT_HINTS);
  // Codebase dimension.
  const needsCode = (req.hasCodingWorkspace ?? false) || hint(text, CODING_HINTS);
  const needsResearch = hint(text, RESEARCH_HINTS) || (req.researchMode ?? false);
  const needsSecurity = needsCode && hint(text, SECURITY_HINTS);
  const needsEducation = hint(text, EDUCATION_HINTS);
  const needsReport = hint(text, REPORT_HINTS) || agents.length >= 2;

  const pushAgent = (agent: AgentId, taskType: TaskType, confidence: number, reason: string) => {
    if (!agents.some((a) => a.agent === agent)) agents.push({ agent, confidence, taskType, reason: [reason] });
  };

  if (needsDocs) {
    pushAgent("document", "document_analysis", 0.8, "Document analysis requested/detected");
    pushAgent("rag", "rag", 0.7, "Grounded retrieval from uploaded documents");
  }
  if (needsResearch) pushAgent("research", "research", 0.85, "Research intent detected");
  if (needsEducation) pushAgent("education", "education", 0.8, "Education/explanation intent");
  if (needsCode) pushAgent("coding", "code_analysis", 0.8, "Code analysis requested/detected");
  if (needsSecurity) pushAgent("security", "security_analysis", 0.8, "Security review requested");
  if (needsReport) pushAgent("report", "reporting", 0.8, "Report synthesis requested");

  // Always have the general agent as a safe fallback when nothing matched.
  if (!agents.length) pushAgent("general", "analysis", 0.5, "Fallback to the general agent");

  if (needsResearch) tools.push({ name: "web_search", reason: "current information", permissions: "auto" });
  if (needsDocs) tools.push({ name: "file_reader", reason: "read uploaded files", permissions: "auto" });
  if (needsCode) tools.push({ name: "coding.read_file", reason: "inspect code", permissions: "auto" });

  const primaryAgent = agents.find((a) => a.agent === primary) ? primary : agents[0].agent;

  return {
    agents,
    tools,
    primary: primaryAgent,
    multiAgent: agents.length > 1,
  };
}

/** Tool router — pick tools for a given task type. */
export function toolsForNode(taskType: TaskType): ToolNeed[] {
  switch (taskType) {
    case "research":
      return [
        { name: "web_search", reason: "discover sources", permissions: "auto" },
        { name: "web_fetch", reason: "read source pages", permissions: "auto" },
      ];
    case "rag":
    case "document_analysis":
      return [{ name: "file_reader", reason: "read uploaded documents", permissions: "auto" }];
    case "code_analysis":
    case "testing":
      return [{ name: "coding.read_file", reason: "inspect code", permissions: "auto" }];
    case "security_analysis":
      return [{ name: "source_lookup", reason: "reference CVEs/OWASP", permissions: "auto" }];
    default:
      return [];
  }
}

/** Wrapper over the Phase 1 classifier for an explicit single-agent request. */
export function classifyExplicit(text: string): OllamaRoute {
  const result = classifyRequest(text, {});
  return { agent: result.agentId as AgentId, confidence: 0.7, reason: result.rationale, requiredContext: [] };
}

/** Lightweight per-node context budget helper (kept here to avoid rag import in tests). */
export async function collectDocumentContext(query: string, documentIds?: string[]): Promise<{ block: string; contexts: unknown[] }> {
  if (!documentIds?.length) return { block: "", contexts: [] };
  const { block, contexts } = await buildRagContextBlock(query, { documentIds, topK: 4 });
  return { block, contexts };
}
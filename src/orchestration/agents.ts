/**
 * Phase 7 — Orchestration agent registry.
 * Reuses the Phase 1 AgentDefinitions where they exist and adds the
 * orchestration-specific roles (rag, report) plus a risk/capability table.
 * The executor discovers capabilities from here instead of hard-coding
 * workflows, matching spec §8.
 */
import type { ApprovalCategory, AgentId, TaskType } from "@/orchestration/types";
import { getAgent as getBaseAgent } from "@/agents/agents/registry";
import type { AgentId as BaseAgentId } from "@/agents/types";

export interface OrchestrationAgent {
  id: AgentId;
  name: string;
  description: string;
  capabilities: string[];
  supportedTaskTypes: TaskType[];
  riskLevel: ApprovalCategory;
  tools: string[];
  /** Whether the role has a real executor adapter in Phase 7. */
  implemented: boolean;
}

const BASE: Record<string, { risk: ApprovalCategory; taskTypes: TaskType[] }> = {
  general: { risk: "READ_ONLY", taskTypes: ["analysis", "generation", "validation", "transformation"] },
  research: { risk: "READ_ONLY", taskTypes: ["research", "generation", "reporting"] },
  education: { risk: "READ_ONLY", taskTypes: ["education", "generation", "validation"] },
  security: { risk: "READ_ONLY", taskTypes: ["security_analysis", "validation", "analysis"] },
  coding: { risk: "LOW_RISK", taskTypes: ["code_analysis", "testing", "generation", "testing", "validation"] },
  document: { risk: "READ_ONLY", taskTypes: ["document_analysis", "analysis", "rag"] },
  rag: { risk: "READ_ONLY", taskTypes: ["rag", "document_analysis", "analysis"] },
  report: { risk: "READ_ONLY", taskTypes: ["reporting", "generation"] },
};

const EXTRA_DEFINITIONS: Partial<Record<AgentId, { name: string; description: string; capabilities: string[]; tools: string[] }>> = {
  rag: {
    name: "RAG",
    description: "Retrieves context from uploaded documents via the vector store with citations.",
    capabilities: ["Semantic retrieval", "Document grounding", "Citation-aware answers"],
    tools: ["file_reader", "source_lookup"],
  },
  report: {
    name: "Report",
    description: "Aggregates verified task outputs and artifacts into a structured final report.",
    capabilities: ["Synthesis", "Artifact linking", "Citation preservation"],
    tools: [],
  },
};

const BASE_AGENTS: BaseAgentId[] = ["assistant", "research", "education", "security", "coding", "document"];

export function orchestrationAgents(): OrchestrationAgent[] {
  const ids: AgentId[] = ["general", "research", "education", "security", "coding", "document", "rag", "report"];
  return ids.map((id) => {
    const base = BASE[id];
    const extra = EXTRA_DEFINITIONS[id];
    const existing = BASE_AGENTS.includes(id as BaseAgentId) ? getBaseAgent(id as BaseAgentId) : undefined;
    return {
      id,
      name: extra?.name ?? existing?.name ?? id,
      description: extra?.description ?? existing?.description ?? "",
      capabilities: extra?.capabilities ?? existing?.capabilities ?? [],
      supportedTaskTypes: base?.taskTypes ?? [],
      riskLevel: base?.risk ?? "READ_ONLY",
      tools: extra?.tools ?? existing?.allowedTools ?? [],
      implemented: true,
    };
  });
}

export function getOrchestrationAgent(id: AgentId): OrchestrationAgent {
  const agents = orchestrationAgents();
  return agents.find((a) => a.id === id) ?? agents[0];
}

export function canAgentHandle(agentId: AgentId, taskType: TaskType): boolean {
  return getOrchestrationAgent(agentId).supportedTaskTypes.includes(taskType);
}

/** First agent that can handle a task type, or "general". */
export function defaultAgentForType(taskType: TaskType): AgentId {
  for (const a of orchestrationAgents()) {
    if (a.supportedTaskTypes.includes(taskType)) return a.id;
  }
  return "general";
}
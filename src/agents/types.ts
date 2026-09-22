/** Agent definitions (spec §6, §13). Loaded from code; mirror in the Agent table. */
export type AgentId = "assistant" | "research" | "education" | "security" | "coding" | "document";

export interface AgentDefinition {
  id: AgentId;
  name: string;
  tagline: string;
  description: string;
  capabilities: string[];
  /** Tool names the agent is allowed to invoke (must exist in the tool registry). */
  allowedTools: string[];
  /** Highest risk level this agent may auto-execute inside a chat loop. */
  maxAutoRisk: "low" | "medium";
  systemPrompt: string;
  /** How the agent should format structured output (education Q&A, report, ...). */
  outputHint: string;
  /** Whether agentic tool-planning is enabled for this agent. */
  toolPlanning: boolean;
  icon: string;
}

export interface PlanStep {
  id: string;
  title: string;
  tool?: string;
  note?: string;
  done?: boolean;
}

export interface PlanningResult {
  agentId: AgentId;
  rationale: string[];
  plan: PlanStep[];
  useTools: boolean;
  researchMode: boolean;
}
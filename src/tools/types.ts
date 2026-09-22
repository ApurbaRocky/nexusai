/**
 * Standardized tool system (spec §14, §15).
 * Every tool defines: name, description, input schema, risk level, execute().
 * Permission model: LOW / MEDIUM auto-executed inside the agent loop;
 * HIGH / CRITICAL always require explicit user confirmation first.
 */
import type { z } from "zod";
import { toJSONSchema } from "zod/v4/core";
import type { RiskLevel } from "@/types";

export interface ToolContext {
  userId: string;
  conversationId?: string;
  projectId?: string;
  documentIds?: string[];
  /** Coding workspace the agent is operating inside (Phase 6 tools). */
  codingWorkspaceId?: string;
  /** Explicit user confirmation for HIGH/CRITICAL actions. */
  confirmed?: boolean;
  /** Prefer snappy, safe defaults. */
  signal?: AbortSignal;
}

export interface ToolOutput {
  /** Plain-text/markdown result fed back to the model and/or user. */
  content: string;
  /** Structured result for the UI/admin dashboard. */
  data?: unknown;
}

export interface ToolDef<In extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: In;
  readonly riskLevel: RiskLevel;
  readonly execute: (args: z.infer<In>, ctx: ToolContext) => Promise<ToolOutput>;
}

export class ToolPermissionError extends Error {
  constructor(name: string, required: RiskLevel, got: RiskLevel) {
    super(`Tool "${name}" requires ${required} permission (current context: ${got}).`);
    this.name = "ToolPermissionError";
  }
}

export class ToolUnavailableError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = "ToolUnavailableError";
  }
}

export function toProviderTool(tool: ToolDef): { name: string; description: string; jsonSchema: Record<string, unknown> } {
  const result = toJSONSchema(tool.inputSchema);
  return {
    name: tool.name,
    description: tool.description,
    jsonSchema: result as Record<string, unknown>,
  };
}

export const RISK_RANK: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function riskAtLeast(level: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_RANK[level] >= RISK_RANK[threshold];
}
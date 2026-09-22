/**
 * Phase 7 — Budget manager (spec §20).
 * Tracks consumption (tokens, cost, tool/file/command counts, runtime) against
 * limits. Cost is ALWAYS real: costUsd stays null unless a known provider/model
 * price is available. We never fabricate cost.
 */
import type { BudgetLimits, BudgetUsage } from "@/orchestration/types";

export const MAX_HANDOFFS = 10;
export const MAX_RETRIES = 3;
export const MAX_TASK_DEPTH = 8;
export const DEFAULT_CONCURRENCY = 4;

export interface BudgetView {
  limits: BudgetLimits;
  usage: BudgetUsage;
  exceeded: string[]; // limit keys that are exceeded
  remainingTokens?: number;
  remainingCostUsd?: number;
}

const EMPTY_USAGE: BudgetUsage = {
  tokens: 0,
  costUsd: null,
  costEstimated: false,
  agentCalls: 0,
  toolCalls: 0,
  filesModified: 0,
  commands: 0,
  runtimeMs: 0,
};

export function emptyUsage(): BudgetUsage {
  return { ...EMPTY_USAGE };
}

export class BudgetManager {
  private limits: BudgetLimits;
  private usage: BudgetUsage;

  constructor(limits: BudgetLimits = {}, usage: BudgetUsage = EMPTY_USAGE) {
    this.limits = limits;
    this.usage = { ...EMPTY_USAGE, ...usage };
  }

  addTokens(tokens: number, costUsd?: number | null, costEstimated = false): void {
    this.usage.tokens += Math.max(0, tokens);
    if (costUsd != null && !Number.isNaN(costUsd) && costUsd >= 0) {
      if (this.usage.costUsd == null && !this.usage.costEstimated) this.usage.costEstimated = costEstimated;
      this.usage.costUsd = (this.usage.costUsd ?? 0) + costUsd;
    }
  }

  addAgentCall(): void {
    this.usage.agentCalls += 1;
  }

  addToolCall(): void {
    this.usage.toolCalls += 1;
  }

  addFileModified(): void {
    this.usage.filesModified += 1;
  }

  addCommand(): void {
    this.usage.commands += 1;
  }

  setRuntimeMs(ms: number): void {
    this.usage.runtimeMs = Math.max(this.usage.runtimeMs, ms);
  }

  get usageSnapshot(): BudgetUsage {
    return { ...this.usage };
  }

  get limitsSnapshot(): BudgetLimits {
    return { ...this.limits };
  }

  private meets(limit: number | undefined, used: number): boolean {
    return limit == null || used <= limit;
  }

  isWithinLimits(nowMs?: number): boolean {
    if (nowMs != null && this.limits.maxRuntimeMs != null) {
      if (nowMs > this.limits.maxRuntimeMs) return false;
    }
    return (
      this.meets(this.limits.maxTokens, this.usage.tokens) &&
      this.meets(this.limits.maxCostUsd, this.usage.costUsd ?? 0) &&
      this.meets(this.limits.maxAgentCalls, this.usage.agentCalls) &&
      this.meets(this.limits.maxToolCalls, this.usage.toolCalls) &&
      this.meets(this.limits.maxFilesModified, this.usage.filesModified) &&
      this.meets(this.limits.maxCommands, this.usage.commands)
    );
  }

  view(nowMs?: number): BudgetView {
    const exceeded: string[] = [];
    if (this.limits.maxTokens != null && this.usage.tokens > this.limits.maxTokens) exceeded.push("maxTokens");
    if (this.limits.maxCostUsd != null && (this.usage.costUsd ?? 0) > this.limits.maxCostUsd) exceeded.push("maxCostUsd");
    if (this.limits.maxAgentCalls != null && this.usage.agentCalls > this.limits.maxAgentCalls) exceeded.push("maxAgentCalls");
    if (this.limits.maxToolCalls != null && this.usage.toolCalls > this.limits.maxToolCalls) exceeded.push("maxToolCalls");
    if (this.limits.maxFilesModified != null && this.usage.filesModified > this.limits.maxFilesModified) exceeded.push("maxFilesModified");
    if (this.limits.maxCommands != null && this.usage.commands > this.limits.maxCommands) exceeded.push("maxCommands");
    if (this.limits.maxRuntimeMs != null && nowMs != null && nowMs > this.limits.maxRuntimeMs) exceeded.push("maxRuntimeMs");
    return {
      limits: this.limitsSnapshot,
      usage: this.usageSnapshot,
      exceeded,
      remainingTokens: this.limits.maxTokens != null ? Math.max(0, this.limits.maxTokens - this.usage.tokens) : undefined,
      remainingCostUsd:
        this.limits.maxCostUsd != null && this.usage.costUsd != null ? Math.max(0, this.limits.maxCostUsd - this.usage.costUsd) : undefined,
    };
  }
}

/** Real per-1k price (USD) only where we have a known price table. Unknown -> null. */
const PRICE_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4.1": { input: 0.002, output: 0.008 },
  "gpt-4.1-mini": { input: 0.0004, output: 0.0016 },
  "claude-3-5-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-7-sonnet": { input: 0.003, output: 0.015 },
  "gemini-2.0-flash": { input: 0.0001, output: 0.0004 },
  "gemini-2.5-pro": { input: 0.00125, output: 0.01 },
};

export function estimateCostUsd(model: string | undefined, promptTokens: number, completionTokens: number): { costUsd: number | null; estimated: boolean } {
  if (!model) return { costUsd: null, estimated: false };
  const price = PRICE_PER_1K[model];
  if (!price) return { costUsd: null, estimated: false };
  const cost = (promptTokens / 1000) * price.input + (completionTokens / 1000) * price.output;
  return { costUsd: Math.round(cost * 1e6) / 1e6, estimated: true };
}
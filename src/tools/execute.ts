/**
 * Tool runner (spec §14, §15, §17): validates args, enforces the permission
 * model, audits every invocation, records ToolCall rows, and produces
 * provider-ready text output.
 *
 * HIGH/CRITICAL actions are ALWAYS gated behind explicit user confirmation.
 * Inside the automated agent loop, only risk <= agent.maxAutoRisk executes;
 * anything riskier is refused and surfaced to the UI for manual approval.
 */
import { z } from "zod";
import type { ToolContext, ToolOutput } from "@/tools/types";
import { getTool } from "@/tools/registry";
import { riskAtLeast } from "@/tools/types";
import type { RiskLevel } from "@/types";
import { prisma } from "@/database/client";
import { audit } from "@/security/audit";
import { log } from "@/utils/log";
import type { AgentDefinition } from "@/agents/types";

export interface RunToolRequest {
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  conversationId?: string;
  projectId?: string;
  documentIds?: string[];
  /** Explicit user confirmation — required for HIGH/CRITICAL. */
  confirmed?: boolean;
  /** Bound the requested tool to an agent's permission ceiling. */
  agent?: AgentDefinition | null;
  requestId?: string;
}

export interface RunToolResult {
  ok: boolean;
  toolName: string;
  content: string;
  data?: unknown;
  riskLevel: RiskLevel;
  permission: "granted" | "needs_confirmation" | "denied";
  durationMs: number;
  error?: string;
}

export async function runTool(req: RunToolRequest): Promise<RunToolResult> {
  const started = Date.now();
  const tool = getTool(req.toolName);
  if (!tool) {
    return fail(req, started, `Tool "${req.toolName}" is not available.`, "unknown tool");
  }

  try {
    // Permission gate 1: absolute HIGH/CRITICAL confirmation.
    if (riskAtLeast(tool.riskLevel, "high") && !req.confirmed) {
      const result: RunToolResult = {
        ok: false,
        toolName: req.toolName,
        content: `This action (${tool.riskLevel} risk) requires your explicit confirmation before it can run.`,
        riskLevel: tool.riskLevel,
        permission: "needs_confirmation",
        durationMs: Date.now() - started,
      };
      await audit("tool.denied", { userId: req.userId }, { tool: req.toolName, reason: "confirmation_required", risk: tool.riskLevel }).catch(() => {});
      return result;
    }

    // Permission gate 2: agent ceiling (automated loop must never exceed it).
    if (req.agent && riskAtLeast(tool.riskLevel, above(req.agent.maxAutoRisk))) {
      const result: RunToolResult = {
        ok: false,
        toolName: req.toolName,
        content: `Tool "${req.toolName}" requires ${tool.riskLevel} permission, which exceeds this agent's ceiling (${req.agent.maxAutoRisk}). It was not executed.`,
        riskLevel: tool.riskLevel,
        permission: "denied",
        durationMs: Date.now() - started,
      };
      await audit("tool.denied", { userId: req.userId }, { tool: req.toolName, reason: "agent_ceiling", risk: tool.riskLevel }).catch(() => {});
      return result;
    }

    // Validation + execution.
    const parsed = safeParse(tool.inputSchema, req.args);
    if (!parsed.ok) {
      return fail(req, started, `Invalid arguments for ${req.toolName}: ${parsed.error}`, "validation");
    }

    const ctx: ToolContext = {
      userId: req.userId,
      conversationId: req.conversationId,
      projectId: req.projectId,
      documentIds: req.documentIds,
      confirmed: req.confirmed,
    };

    const output = await tool.execute(parsed.data, ctx);

    await persistCall(req, tool.name, req.args, output, tool.riskLevel, started, true);
    await audit("tool.execute", { userId: req.userId }, { tool: req.toolName, risk: tool.riskLevel, durationMs: Date.now() - started }).catch(() => {});
    log.info("tool-executed", { requestId: req.requestId, tool: req.toolName, risk: tool.riskLevel, durationMs: Date.now() - started });

    return {
      ok: true,
      toolName: req.toolName,
      content: output.content,
      data: output.data,
      riskLevel: tool.riskLevel,
      permission: "granted",
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await persistCall(req, req.toolName, req.args, { error: message }, tool.riskLevel, started, false);
    log.error("tool-failed", { requestId: req.requestId, tool: req.toolName, error: message });
    return fail(req, started, message, "execution_error", message);
  }
}

function above(level: "low" | "medium"): RiskLevel {
  return level === "low" ? "medium" : "high";
}

function safeParse<In extends z.ZodTypeAny>(schema: In, args: Record<string, unknown>) {
  const result = schema.safeParse(args);
  if (result.success) return { ok: true as const, data: result.data };
  const first = result.error.issues[0];
  return { ok: false as const, error: first?.message ?? "invalid arguments" };
}

function fail(req: RunToolRequest, started: number, content: string, error: string, detail = error): RunToolResult {
  return {
    ok: false,
    toolName: req.toolName,
    content,
    riskLevel: "medium",
    permission: "denied",
    durationMs: Date.now() - started,
    error: detail,
  };
}

async function persistCall(
  req: RunToolRequest,
  toolName: string,
  args: Record<string, unknown>,
  output: ToolOutput | { error: string },
  riskLevel: RiskLevel,
  started: number,
  success: boolean,
) {
  try {
    await prisma.toolCall.create({
      data: {
        userId: req.userId,
        conversationId: req.conversationId ?? null,
        toolName,
        input: JSON.stringify(sanitizeArgs(args)),
        output: JSON.stringify(output),
        success,
        riskLevel,
        durationMs: Date.now() - started,
        error: success ? null : "error" in output ? output.error : undefined,
      },
    });
  } catch {
    // never block the flow on bookkeeping
  }
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (/secret|key|password|token|authorization/i.test(k)) continue;
    clone[k] = typeof v === "string" && v.length > 20_000 ? `${v.slice(0, 20_000)}…` : v;
  }
  return clone;
}
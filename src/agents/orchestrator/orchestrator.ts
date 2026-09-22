/**
 * MAIN AI ORCHESTRATOR (spec §5).
 *
 * Understand intent -> classify -> plan -> select agent -> select model ->
 * select tools -> execute (agentic loop) -> verify -> synthesize ->
 * emit final response with sources.
 *
 * Yields normalized StreamEvents for the chat route, which persists incrementally.
 */
import type { AgentDefinition } from "@/agents/types";
import type { ChatMessage, StreamEvent, ChatSource } from "@/types";
import { streamEvent } from "@/types";
import type { AIProvider, ModelInfo, ProviderStreamEvent } from "@/ai/providers/base";
import { buildBaseSystemPrompt } from "@/ai/prompts/safety";
import { runTool } from "@/tools/execute";
import { toolsByNames } from "@/tools/registry";
import { toProviderTool } from "@/tools/types";
import { prisma } from "@/database/client";
import { log } from "@/utils/log";

const MAX_AGENT_ITERATIONS = 4;

export interface OrchestrationInput {
  userId: string;
  conversationId: string;
  messageId: string;
  prompt: string;
  history: ChatMessage[];
  model: ModelInfo;
  provider: AIProvider;
  apiKey?: string;
  agent: AgentDefinition;
  researchMode: boolean;
  language?: "en" | "bn";
  memoryBlock?: string;
  requestId: string;
  projectId?: string | null;
  exposedSources?: boolean;
}

export interface OrchestrationResult {
  text: string;
  sources: ChatSource[];
  toolCalls: { name: string; success: boolean; durationMs: number; permission: string }[];
  promptTokens?: number;
  completionTokens?: number;
}

export async function* orchestrate(input: OrchestrationInput): AsyncGenerator<StreamEvent, OrchestrationResult, void> {
  const started = Date.now();
  const system = buildBaseSystemPrompt({
    agentName: input.agent.name,
    agentDescription: `${input.agent.tagline}. ${input.agent.outputHint}`,
    language: input.language,
    researchMode: input.researchMode,
    memoryBlock: input.memoryBlock,
    modelLabel: input.model.label,
  });

  const messages: ChatMessage[] = [...input.history];
  const canUseTools = input.model.supportsTools && input.agent.toolPlanning;
  const selectedTools = canUseTools ? toolsByNames(input.agent.allowedTools) : [];

  const sources: ChatSource[] = [];
  let fullText = "";
  let usage: { promptTokens?: number; completionTokens?: number } = {};
  const executed = [];

  const providerTools = selectedTools.length
    ? selectedTools.map((t) => ({ name: t.name, description: t.description, jsonSchema: toProviderTool(t).jsonSchema }))
    : undefined;

  for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
    const params = {
      model: input.model,
      messages,
      system,
      tools: providerTools,
      apiKey: input.apiKey,
    };

    const calls: { id: string; name: string; args: Record<string, unknown> }[] = [];
    let iterText = "";

    for await (const event of streamProvider(input.provider, params)) {
      switch (event.type) {
        case "text_delta":
          iterText += event.content;
          fullText += event.content;
          yield streamEvent("text_delta", { content: event.content });
          break;
        case "reasoning_delta":
          yield streamEvent("reasoning_delta", { content: event.content });
          break;
        case "tool_call":
          calls.push(event.call);
          break;
        case "source": {
          const src = event.source;
          sources.push(src);
          yield streamEvent("source", { source: src });
          break;
        }
        case "usage":
          usage = {
            promptTokens: event.promptTokens ?? usage.promptTokens,
            completionTokens: event.completionTokens ?? usage.completionTokens,
          };
          yield streamEvent("usage", {
            promptTokens: event.promptTokens,
            completionTokens: event.completionTokens,
            totalTokens: (event.promptTokens ?? 0) + (event.completionTokens ?? 0),
          });
          break;
        case "done":
        case "tool_call_delta":
          break;
      }
    }

    if (iterText) messages.push({ role: "assistant", content: iterText });
    if (calls.length) messages.push({ role: "assistant", content: iterText, toolCalls: calls });

    if (!calls.length || !selectedTools.length) break;

    // Execute the requested tools (respecting agent permission ceiling).
    let allSucceeded = true;
    for (const call of calls) {
      const tool = selectedTools.find((t) => t.name === call.name);
      if (!tool) {
        messages.push({ role: "tool", name: call.name, toolCallId: call.id, content: `Unknown tool: ${call.name}` });
        allSucceeded = false;
        continue;
      }
      yield streamEvent("tool_start", { tool: call.name, input: call.args });
      const result = await runTool({
        userId: input.userId,
        conversationId: input.conversationId,
        projectId: input.projectId ?? undefined,
        toolName: call.name,
        args: call.args,
        agent: input.agent,
        requestId: input.requestId,
      });

      executed.push({ name: call.name, success: result.ok, durationMs: result.durationMs, permission: result.permission });

      if (result.permission === "needs_confirmation" || result.permission === "denied") {
        allSucceeded = false;
        yield streamEvent("tool_result", { tool: call.name, success: false, summary: result.content.slice(0, 300) });
        messages.push({ role: "tool", name: call.name, toolCallId: call.id, content: result.content });
        continue;
      }
      if (!result.ok) allSucceeded = false;
      yield streamEvent("tool_result", { tool: call.name, success: result.ok, summary: result.content.slice(0, 300) });
      messages.push({ role: "tool", name: call.name, toolCallId: call.id, content: result.content });

      if (tool.name === "web_search" && result.data && Array.isArray((result.data as { results?: ChatSource[] }).results)) {
        const results = (result.data as { results: ChatSource[] }).results;
        for (const r of results.slice(0, 5)) {
          if (!sources.some((s) => s.url === r.url)) sources.push(r);
        }
      }
    }

    if (!allSucceeded && calls.some((c) => !selectedTools.some((t) => t.name === c.name))) break;
    if (!calls.some((c) => selectedTools.some((t) => t.name === c.name))) break;
  }

  await recordUsage(input, usage, started);

  yield streamEvent("done", { messageId: input.messageId, conversationId: input.conversationId });
  return {
    text: fullText,
    sources,
    toolCalls: executed,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  };
}

async function* streamProvider(provider: AIProvider, params: Parameters<AIProvider["streamChat"]>[0]): AsyncGenerator<ProviderStreamEvent> {
  try {
    for await (const ev of provider.streamChat(params)) yield ev;
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI provider error";
    log.error("orchestrator-provider-error", { message });
    throw err;
  }
}

async function recordUsage(input: OrchestrationInput, usage: { promptTokens?: number; completionTokens?: number }, started: number) {
  try {
    await prisma.apiUsage.create({
      data: {
        userId: input.userId,
        provider: input.model.provider,
        model: input.model.id,
        kind: "chat",
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
        durationMs: Date.now() - started,
      },
    });
  } catch {
    /* non-blocking */
  }
}
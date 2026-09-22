/**
 * OpenAI and OpenAI-compatible providers (OpenAI, OpenRouter, Groq, Ollama,
 * LM Studio, vLLM, etc.). Talk to any of them by pointing baseUrl + key.
 * Streaming chat completions with tool calling + embeddings.
 */
import type {
  AIProvider,
  ChatParams,
  ModelInfo,
  ProviderStreamEvent,
  ProviderToolDef,
} from "@/ai/providers/base";
import { fetchWithRetry, finalizeToolArgs, ProviderUnavailableError, streamSse } from "@/ai/providers/base";
import type { ChatMessage } from "@/types";
import { log } from "@/utils/log";

export interface OpenAICompatibleConfig {
  apiKey?: string;
  baseUrl: string;
  models: ModelInfo[];
  label: string;
  id: "openai" | "local";
}

const toolDef = (t: ProviderToolDef) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: (t.jsonSchema ?? {}) as Record<string, unknown> },
});

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: "openai" | "local";
  readonly label: string;

  private baseUrl: string;
  private serverKey: string;

  constructor(config: OpenAICompatibleConfig) {
    this.id = config.id;
    this.label = config.label;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.serverKey = config.apiKey ?? "";
    this.models = config.models;
  }

  readonly models: ModelInfo[];

  listModels() {
    return this.models;
  }

  isConfigured(options?: { apiKey?: string; modelId?: string }) {
    const key = options?.apiKey?.trim() ?? this.serverKey;
    if (key) return true;
    const model = options?.modelId ? this.models.find((m) => m.id === options.modelId) : undefined;
    return !!(model && model.keySource === "none");
  }

  private headers(apiKey?: string) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(apiKey?.trim() || this.serverKey).trim()}`,
    };
  }

  async *streamChat(params: ChatParams): AsyncIterable<ProviderStreamEvent> {
    const apiKey = this.resolveKey(params);
    if (!apiKey) throw new ProviderUnavailableError("No API key configured for this OpenAI-compatible provider.");

    const body: Record<string, unknown> = {
      model: params.model.apiModel,
      messages: params.messages.map(openAiMessage),
      stream: true,
      temperature: params.temperature ?? 0.7,
    };
    if (params.system) body.messages = [{ role: "system", content: params.system }, ...(params.messages.map(openAiMessage))];
    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (params.tools?.length) body.tools = params.tools.map(toolDef);

    const res = await fetchWithRetry(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("openai-compatible error", { status: res.status, body: text.slice(0, 500) });
      if (res.status === 401) throw new ProviderUnavailableError("Invalid API key for this provider.");
      throw new ProviderUnavailableError("AI provider unavailable.");
    }

    const pendingToolCalls = new Map<string, { functionName: string[]; args: string[] }>();

    for await (const event of streamSse(res, (line) => parseChatLine(line, pendingToolCalls))) {
      yield event;
    }
    for (const call of flushToolCalls(pendingToolCalls)) {
      yield { type: "tool_call", call };
    }
    yield { type: "done" };
  }

  private resolveKey(params: ChatParams): string | undefined {
    return params.apiKey?.trim() || this.serverKey || undefined;
  }

  async complete(params: ChatParams): Promise<{ content: string; promptTokens?: number; completionTokens?: number }> {
    const apiKey = this.resolveKey(params);
    if (!apiKey) throw new ProviderUnavailableError("No API key configured for this OpenAI-compatible provider.");

    const body: Record<string, unknown> = {
      model: params.model.apiModel,
      messages: [
        ...(params.system ? [{ role: "system", content: params.system }] : []),
        ...params.messages.map(openAiMessage),
      ],
      temperature: params.temperature ?? 0.7,
    };
    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (params.tools?.length) body.tools = params.tools.map(toolDef);

    const res = await fetchWithRetry(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("openai-compatible complete error", { status: res.status, body: text.slice(0, 500) });
      throw new ProviderUnavailableError("AI provider unavailable.");
    }
    const data = (await res.json()) as {
      choices: { message?: { content?: string | null; tool_calls?: unknown[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    };
  }

  async embed(texts: string[], modelId?: string): Promise<number[][]> {
    const apiKey = this.serverKey;
    if (!apiKey) throw new ProviderUnavailableError("No API key configured for embeddings.");
    const res = await fetchWithRetry(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify({ model: modelId ?? "text-embedding-3-small", input: texts }),
    });
    if (!res.ok) throw new ProviderUnavailableError("Embedding service unavailable.");
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    return data.data.map((d) => d.embedding);
  }
}

function openAiMessage(msg: ChatMessage): Record<string, unknown> {
  if (msg.role === "tool") {
    return { role: "tool", tool_call_id: msg.toolCallId ?? msg.name ?? "call_unknown", content: msg.content };
  }
  if (msg.role === "developer") return { role: "system", content: msg.content };
  if (msg.role === "assistant" && msg.toolCalls?.length) {
    const m: Record<string, unknown> = {
      role: "assistant",
      content: msg.content || null,
      tool_calls: msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    };
    return m;
  }
  return { role: msg.role, content: msg.content };
}

function parseChatLine(
  line: string,
  pending: Map<string, { functionName: string[]; args: string[] }>,
): ProviderStreamEvent | ProviderStreamEvent[] | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;

  let json: {
    choices?: { delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: unknown[] } }[];
  };
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }

  const events: ProviderStreamEvent[] = [];
  const delta = json.choices?.[0]?.delta;
  if (!delta) return events.length ? events : null;

  if (delta.content) events.push({ type: "text_delta", content: delta.content });
  if (delta.reasoning_content) events.push({ type: "reasoning_delta", content: delta.reasoning_content });

  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls as {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }[]) {
      const idx = tc.index ?? 0;
      const slot = pending.get(String(idx)) ?? { functionName: [], args: [] };
      if (tc.id) slot.functionName.push(tc.id);
      if (tc.function?.name) slot.functionName.push(tc.function.name);
      if (tc.function?.arguments) slot.args.push(tc.function.arguments);
      pending.set(String(idx), slot);
      events.push({
        type: "tool_call_delta",
        delta: {
          id: (tc.id ?? `call_${idx}`) as string,
          name: tc.function?.name ?? "",
          args: tc.function?.arguments ?? "",
        },
      });
    }
  }
  return events.length ? events : null;
}

export function flushToolCalls(
  pending: Map<string, { functionName: string[]; args: string[] }>,
): { id: string; name: string; args: Record<string, unknown> }[] {
  const out: { id: string; name: string; args: Record<string, unknown> }[] = [];
  for (const [idx, val] of pending) {
    const name = val.functionName.at(-1) ?? "";
    const id = val.functionName[0] ?? `call_${idx}`;
    const argsJoined = val.args.join("");
    try {
      out.push({ id, name, args: argsJoined ? JSON.parse(argsJoined) : {} });
    } catch {
      out.push({ id, name, args: finalizeToolArgs({ raw: argsJoined }) });
    }
  }
  return out;
}
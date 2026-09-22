/**
 * Anthropic Messages API provider. SSE streaming with tool use support.
 */
import type {
  AIProvider,
  ChatParams,
  ModelInfo,
  ProviderStreamEvent,
  ProviderToolDef,
} from "@/ai/providers/base";
import { fetchWithRetry, ProviderUnavailableError, streamSse } from "@/ai/providers/base";
import type { ChatMessage } from "@/types";
import { log } from "@/utils/log";

const API_VERSION = "2023-06-01";

export interface AnthropicConfig {
  apiKey?: string;
  baseUrl?: string;
  models: ModelInfo[];
}

interface ToolUseAccumulator {
  id: string;
  name: string;
  args: string[];
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly label = "Anthropic";
  readonly models: ModelInfo[];
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey ?? "";
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
    this.models = config.models;
  }

  listModels() {
    return this.models;
  }

  isConfigured(options?: { apiKey?: string }) {
    return !!(options?.apiKey?.trim() || this.apiKey);
  }

  private headers(apiKey?: string) {
    return {
      "Content-Type": "application/json",
      "x-api-key": (apiKey?.trim() || this.apiKey).trim(),
      "anthropic-version": API_VERSION,
    };
  }

  async *streamChat(params: ChatParams): AsyncIterable<ProviderStreamEvent> {
    const apiKey = params.apiKey?.trim() || this.apiKey;
    if (!apiKey) throw new ProviderUnavailableError("No API key configured for Anthropic.");

    const body: Record<string, unknown> = {
      model: params.model.apiModel,
      max_tokens: params.maxTokens ?? 4096,
      messages: toAnthropicMessages(params.messages),
      stream: true,
      temperature: params.temperature ?? 0.7,
    };
    if (params.system) body.system = params.system;
    if (params.tools?.length) body.tools = params.tools.map(toAnthropicTool);

    const res = await fetchWithRetry(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("anthropic error", { status: res.status, body: text.slice(0, 500) });
      if (res.status === 401 || res.status === 403) throw new ProviderUnavailableError("Invalid API key for Anthropic.");
      throw new ProviderUnavailableError("Anthropic is temporarily unavailable.");
    }

    const toolUses = new Map<number, ToolUseAccumulator>();
    const textBuffer: string[] = [];
    let usageSeen = false;

    for await (const event of parseAnthropicSse(res, toolUses, textBuffer)) {
      yield event;
      usageSeen = true;
    }

    for (const tu of toolUses.values()) {
      const argsJoined = tu.args.join("");
      let args: Record<string, unknown> = {};
      try {
        args = argsJoined ? JSON.parse(argsJoined) : {};
      } catch {
        args = { raw: argsJoined };
      }
      yield { type: "tool_call", call: { id: tu.id, name: tu.name, args } };
    }

    if (!usageSeen && !toolUses.size && !textBuffer.length) {
      // No text, no tool calls: report as unavailable to avoid silent empty answers.
      throw new ProviderUnavailableError("Anthropic returned an empty response.");
    }
    yield { type: "done" };
  }

  async complete(params: ChatParams): Promise<{ content: string; promptTokens?: number; completionTokens?: number }> {
    const apiKey = params.apiKey?.trim() || this.apiKey;
    if (!apiKey) throw new ProviderUnavailableError("No API key configured for Anthropic.");

    const body: Record<string, unknown> = {
      model: params.model.apiModel,
      max_tokens: params.maxTokens ?? 4096,
      messages: toAnthropicMessages(params.messages),
      temperature: params.temperature ?? 0.7,
    };
    if (params.system) body.system = params.system;
    if (params.tools?.length) body.tools = params.tools.map(toAnthropicTool);

    const res = await fetchWithRetry(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("anthropic complete error", { status: res.status, body: text.slice(0, 500) });
      throw new ProviderUnavailableError("Anthropic is temporarily unavailable.");
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return { content: text, promptTokens: data.usage?.input_tokens, completionTokens: data.usage?.output_tokens };
  }
}

function toAnthropicTool(t: ProviderToolDef) {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.jsonSchema ?? { type: "object", properties: {} },
  };
}

function toAnthropicMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") continue; // system passed separately
    if (m.role === "assistant" && m.toolCalls?.length) {
      const content: Record<string, unknown>[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      out.push({ role: "assistant", content });
      continue;
    }
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: m.toolCallId ?? m.name ?? "", content: m.content || "(no output)" },
        ],
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return mergeConsecutiveUsers(out);
}

function mergeConsecutiveUsers(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = [];
  for (const m of messages) {
    const last = merged.at(-1);
    if (last && last.role === "user" && m.role === "user") {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      merged.push({ ...m });
    }
  }
  // Anthropic requires alternating roles; assistant content may be empty only in tool loops.
  return merged.filter((m) => m.content !== "" || (Array.isArray(m.content) && m.content.length > 0));
}

function parseAnthropicSse(
  res: Response,
  toolUses: Map<number, ToolUseAccumulator>,
  textBuffer: string[],
): AsyncGenerator<ProviderStreamEvent> {
  return streamSse(res, (rawLine) => {
    const line = rawLine.startsWith("data:") ? rawLine.slice(5).trim() : "";
    if (!line || line === "[DONE]") return null;
    let json: {
      type?: string;
      index?: number;
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string };
      usage?: { input_tokens?: number; output_tokens?: number };
      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
    };
    try {
      json = JSON.parse(line);
    } catch {
      return null;
    }

    switch (json.type) {
      case "content_block_start": {
        const idx = json.index ?? 0;
        const block = json.content_block;
        if (block?.type === "tool_use") {
          toolUses.set(idx, { id: block.id ?? `toolu_${idx}`, name: block.name ?? "", args: [] });
          return { type: "tool_call_delta", delta: { id: block.id ?? `toolu_${idx}`, name: block.name ?? "", args: "" } };
        }
        return null;
      }
      case "content_block_delta": {
        const idx = json.index ?? 0;
        const delta = json.delta;
        if (delta?.type === "text_delta" && delta.text) {
          textBuffer.push(delta.text);
          return { type: "text_delta", content: delta.text };
        }
        if (delta?.type === "input_json_delta" && delta.partial_json) {
          const tu = toolUses.get(idx);
          if (tu) tu.args.push(delta.partial_json);
          return {
            type: "tool_call_delta",
            delta: { id: tu?.id ?? `toolu_${idx}`, name: tu?.name ?? "", args: delta.partial_json },
          };
        }
        return null;
      }
      case "message_start": {
        const usage = json.message?.usage;
        return usage ? { type: "usage", promptTokens: usage.input_tokens, completionTokens: usage.output_tokens } : null;
      }
      case "message_delta": {
        return json.usage
          ? { type: "usage", promptTokens: json.usage.input_tokens, completionTokens: json.usage.output_tokens }
          : null;
      }
      default:
        return null;
    }
  });
}
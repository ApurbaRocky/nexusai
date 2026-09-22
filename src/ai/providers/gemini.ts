/**
 * Google Gemini provider. SSE streaming (cumulative text diffed to deltas).
 * Tool calling emits only final functionCall parts (Gemini has no streaming
 * partial-args for REST).
 */
import type {
  AIProvider,
  ChatParams,
  ModelInfo,
  ProviderStreamEvent,
} from "@/ai/providers/base";
import { fetchWithRetry, ProviderUnavailableError, streamSse } from "@/ai/providers/base";
import type { ChatMessage } from "@/types";
import { log } from "@/utils/log";

export interface GeminiConfig {
  apiKey?: string;
  baseUrl?: string;
  models: ModelInfo[];
}

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly label = "Google Gemini";
  readonly models: ModelInfo[];
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey ?? "";
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    this.models = config.models;
  }

  listModels() {
    return this.models;
  }

  isConfigured(options?: { apiKey?: string }) {
    return !!(options?.apiKey?.trim() || this.apiKey);
  }

  private url(modelApiName: string, extra: string) {
    return `${this.baseUrl}/models/${encodeURIComponent(modelApiName)}:${extra}`;
  }

  async *streamChat(params: ChatParams): AsyncIterable<ProviderStreamEvent> {
    const apiKey = params.apiKey?.trim() || this.apiKey;
    if (!apiKey) throw new ProviderUnavailableError("No API key configured for Gemini.");

    const systemInstruction = params.system
      ? { parts: [{ text: params.system }] }
      : undefined;

    const body: Record<string, unknown> = {
      contents: toGeminiContents(params.messages),
      generationConfig: { temperature: params.temperature ?? 0.7, maxOutputTokens: params.maxTokens ?? 4096 },
      ...(systemInstruction ? { systemInstruction } : {}),
    };
    if (params.tools?.length) {
      body.tools = [
        {
          functionDeclarations: params.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.jsonSchema ?? { type: "object", properties: {} },
          })),
        },
      ];
    }

    const url = `${this.url(params.model.apiModel, "streamGenerateContent")}?alt=sse`;
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("gemini error", { status: res.status, body: text.slice(0, 500) });
      if (res.status === 400 && /API key/i.test(text)) throw new ProviderUnavailableError("Invalid API key for Gemini.");
      throw new ProviderUnavailableError("Gemini is temporarily unavailable.");
    }

    let lastText = "";
    for await (const event of streamSse(res, (line) => {
      if (!line.startsWith("data:")) return null;
      const payload = line.slice(5).trim();
      if (!payload) return null;
      let json: {
        candidates?: {
          content?: { parts?: { text?: string; functionCall?: GeminiFunctionCall }[] };
          finishReason?: string;
        }[];
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      try {
        json = JSON.parse(payload);
      } catch {
        return null;
      }
      const events: ProviderStreamEvent[] = [];
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.functionCall) {
          const fc = part.functionCall;
          events.push({ type: "tool_call", call: { id: fc.name ?? crypto.randomUUID(), name: fc.name ?? "unknown", args: fc.args ?? {} } });
          continue;
        }
        if (part.text) {
          const delta = part.text.slice(lastText.length);
          lastText = part.text;
          if (delta) events.push({ type: "text_delta", content: delta });
        }
      }
      const usage = json.usageMetadata;
      if (usage) {
        events.push({
          type: "usage",
          promptTokens: usage.promptTokenCount,
          completionTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount,
        });
      }
      return events.length ? events : null;
    })) {
      yield event;
    }
    yield { type: "done" };
  }

  async complete(params: ChatParams): Promise<{ content: string }> {
    const apiKey = params.apiKey?.trim() || this.apiKey;
    if (!apiKey) throw new ProviderUnavailableError("No API key configured for Gemini.");
    const systemInstruction = params.system ? { parts: [{ text: params.system }] } : undefined;
    const body: Record<string, unknown> = {
      contents: toGeminiContents(params.messages),
      generationConfig: { temperature: params.temperature ?? 0.7, maxOutputTokens: params.maxTokens ?? 4096 },
      ...(systemInstruction ? { systemInstruction } : {}),
    };
    const url = this.url(params.model.apiModel, "generateContent");
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ProviderUnavailableError("Gemini is temporarily unavailable.");
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return {
      content: (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
    };
  }

  async embed(texts: string[], modelId?: string): Promise<number[][]> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new ProviderUnavailableError("No API key configured for Gemini embeddings.");
    const model = modelId ?? "text-embedding-004";
    const url = this.url(model, "batchEmbedContents");
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ requests: texts.slice(0, 100).map((content) => ({ model: model.replace(/:\w+$/, ""), content: { parts: [{ text: content }] } })) }),
    });
    if (!res.ok) throw new ProviderUnavailableError("Embedding service unavailable.");
    const data = (await res.json()) as { embeddings?: { values?: number[] }[] };
    return (data.embeddings ?? []).map((e) => e.values ?? []);
  }
}

interface GeminiFunctionCall {
  name?: string;
  args?: Record<string, unknown>;
}

function toGeminiContents(messages: ChatMessage[]): Record<string, unknown>[] {
  const contents: Record<string, unknown>[] = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : m.role === "tool" ? "function" : "user";
    if (m.role === "system" || m.role === "developer") continue;
    if (m.role === "assistant" && m.toolCalls?.length) {
      const parts: Record<string, unknown>[] = m.content ? [{ text: m.content }] : [];
      for (const tc of m.toolCalls) parts.push({ functionCall: { name: tc.name, args: tc.args } });
      contents.push({ role: "model", parts });
      continue;
    }
    if (m.role === "tool") {
      contents.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name: m.name,
              response: { result: m.content || "(no output)" },
            },
          },
        ],
      });
      continue;
    }
    contents.push({ role, parts: [{ text: m.content }] });
  }
  return mergeConsecutive(contents);
}

function mergeConsecutive(contents: Record<string, unknown>[]): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = [];
  for (const c of contents) {
    const last = merged.at(-1);
    if (last && last.role === c.role && last.role === "user") {
      const parts = last.parts as { text: string }[];
      const text = (c.parts as { text: string }[])[0]?.text ?? "";
      parts.push({ text });
    } else {
      merged.push({ ...c });
    }
  }
  return merged;
}
/**
 * Provider-independent AI abstraction.
 * A provider streams token deltas and (optionally) tool calls. Consumers
 * (orchestrator, chat route) never import a concrete provider SDK.
 */
import type { ChatMessage, ChatSource } from "@/types";

export type ProviderId = "openai" | "anthropic" | "gemini" | "local" | "demo";

export interface ModelInfo {
  /** Unique id used across the app, e.g. settings storage. */
  id: string;
  provider: ProviderId;
  label: string;
  /** Underlying model name sent to the provider API. */
  apiModel: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  /** Whether it is a clearly-labelled mock/demo model. */
  mock?: boolean;
  /** User-supplied (encrypted, per-user) key vs server env key. */
  keySource?: "user" | "server" | "none";
}

export interface ToolCallDelta {
  id: string;
  name: string;
  args: string; // partial JSON
}

export type ProviderStreamEvent =
  | { id?: string; type: "text_delta"; content: string }
  | { id?: string; type: "reasoning_delta"; content: string }
  | { id?: string; type: "tool_call_delta"; delta: ToolCallDelta }
  | { id?: string; type: "tool_call"; call: { id: string; name: string; args: Record<string, unknown> } }
  | { id?: string; type: "source"; source: ChatSource }
  | { id?: string; type: "usage"; promptTokens?: number; completionTokens?: number; totalTokens?: number }
  | { id?: string; type: "done"; messageId?: string; conversationId?: string };

export interface ProviderToolDef {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
}

export interface ChatParams {
  model: ModelInfo;
  messages: ChatMessage[];
  system?: string;
  tools?: ProviderToolDef[];
  /** Optional direct API key (e.g. the user's own encrypted key). */
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Available model definitions for this provider given current config. */
  listModels(): ModelInfo[];
  /** True when the provider has a usable API key (server or supplied). */
  isConfigured(options?: { apiKey?: string; modelId?: string }): boolean;
  streamChat(params: ChatParams): AsyncIterable<ProviderStreamEvent>;
  /**
   * Non-streaming completion (used by workflows, research, and RAG).
   * Every provider implements this: the streaming path is a UI convenience,
   * while workflows need a single awaited answer.
   */
  complete(params: ChatParams): Promise<{ content: string; promptTokens?: number; completionTokens?: number }>;
  /** Embeddings for the RAG pipeline. Optional; local/OpenAI-compatible expose it. */
  embed?(texts: string[], modelId?: string): Promise<number[][]>;
}

export class ProviderUnavailableError extends Error {
  constructor(message = "AI provider unavailable.") {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Simple SSE streaming parse helpers shared by the HTTP-based providers.
// ---------------------------------------------------------------------------

export async function* streamSse(
  response: Response,
  parseLine: (line: string) => ProviderStreamEvent | ProviderStreamEvent[] | null,
): AsyncGenerator<ProviderStreamEvent> {
  if (!response.body) throw new ProviderUnavailableError("Empty response from AI provider.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        const event = parseLine(line);
        if (event) {
          if (Array.isArray(event)) yield* event;
          else yield event;
        }
        idx = buffer.indexOf("\n");
      }
    }
    const events = parseLine(buffer.trim());
    if (events) {
      if (Array.isArray(events)) yield* events;
      else yield events;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

/** Calls a provider JSON API with timeout + retry on 429/5xx. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 2,
  baseDelayMs = 800,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      const retriable = res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503;
      if (retriable && attempt < retries) {
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }
  throw lastError ?? new Error("Network error calling AI provider.");
}

export function finalizeToolArgs(partial: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial)) {
    try {
      result[k] = JSON.parse(v);
    } catch {
      result[k] = v;
    }
  }
  return result;
}

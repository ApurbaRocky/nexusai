/**
 * LLM glue for the coding agent. Resolves the best configured model for a
 * user (reusing provider registry), builds ChatMessage sequences and offers a
 * strict-ish JSON extraction helper for structured engine output.
 */
import type { ChatMessage } from "@/types";
import { getProvider, getAvailableModels, isDemoEnabled } from "@/ai/providers/registry";
import { type ModelInfo, type ProviderId } from "@/ai/providers/base";
import { getUserApiKey } from "@/security/api-key-resolver";

export class CodingLlmUnavailableError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CodingLlmUnavailableError";
  }
}

interface ResolvedModel {
  providerId: string;
  modelId: string;
  apiKey?: string;
}

const PREFERRED_CODING_MODEL_IDS = [
  "openai:gpt-4o",
  "anthropic:claude-sonnet-4-5",
  "anthropic:claude-haiku-4-5",
  "openai:o3-mini",
  "gemini:gemini-2.5-flash",
  "local:llama3.1",
  "demo:assistant",
];

/** Pick the best coding-capable model actually available to the user. */
export async function resolveCodingModel(userId: string): Promise<ResolvedModel> {
  const available = await getAvailableModels(userId);

  // Prefer listed ids in order, then any available non-demo model.
  for (const id of PREFERRED_CODING_MODEL_IDS) {
    const m = available.find((x) => x.id === id && x.available);
    if (m) return resolveFromInfo(userId, m);
  }
  const any = available.find((m) => m.provider !== "demo" && m.available);
  if (any) return resolveFromInfo(userId, any);
  if (isDemoEnabled()) {
    const demo = available.find((m) => m.provider === "demo" && m.available);
    if (demo) return { providerId: "demo", modelId: demo.id };
  }
  throw new CodingLlmUnavailableError("No AI model is configured. Add an API key in Settings → API keys, or enable demo mode.");
}

async function resolveFromInfo(userId: string, m: { id: string; provider: string }): Promise<ResolvedModel> {
  const resolved = { providerId: m.provider, modelId: m.id };
  if (m.provider === "openai" || m.provider === "anthropic" || m.provider === "gemini") {
    const key = await getUserApiKey(userId, m.provider as "openai" | "anthropic" | "gemini");
    if (key) return { ...resolved, apiKey: key };
  }
  return resolved;
}

/** Non-streaming completion with the coding model. */
export async function codingComplete(
  userId: string,
  opts: { system?: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number },
): Promise<string> {
  const model = await resolveCodingModel(userId);
  try {
    const provider = getProvider(model.providerId as never, model.apiKey);
    const full: ModelInfo = { id: model.modelId, provider: model.providerId as ProviderId, label: "", apiModel: model.modelId, contextWindow: 128000, supportsTools: true, supportsVision: false };
    const res = await provider.complete({ model: full, system: opts.system, messages: safeMessages(opts.messages), temperature: opts.temperature ?? 0.3, maxTokens: opts.maxTokens ?? 4096, apiKey: model.apiKey });
    return res.content;
  } catch (err) {
    console.error("[coding:llm]", err);
    throw new CodingLlmUnavailableError(err instanceof Error ? err.message : "LLM call failed.");
  }
}

function safeMessages(messages: ChatMessage[]): ChatMessage[] {
  // Cap total roughly at ~90k chars to stay inside context budgets.
  let total = 0;
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const t = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    total += t.length;
    if (total > 90_000 && out.length) break;
    out.push(m);
  }
  return out;
}

/** Best-effort extraction of a JSON object from a messy LLM answer. */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* fall through */
  }
  const block = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (block) {
    try {
      return JSON.parse(block[1].trim()) as T;
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(slice) as T;
    } catch {
      /* fall through */
    }
  }
  throw new Error("Could not parse structured model output as JSON.");
}
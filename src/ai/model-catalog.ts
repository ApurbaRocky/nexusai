/**
 * Static model catalog. Providers are wired up at runtime in the registry.
 * Add new models here without touching provider implementations.
 */
import type { ModelInfo } from "@/ai/providers/base";

export const MODEL_CATALOG: ModelInfo[] = [
  // OpenAI
  { id: "openai:gpt-4o", provider: "openai", label: "GPT-4o", apiModel: "gpt-4o", contextWindow: 128000, supportsTools: true, supportsVision: true },
  { id: "openai:gpt-4o-mini", provider: "openai", label: "GPT-4o mini", apiModel: "gpt-4o-mini", contextWindow: 128000, supportsTools: true, supportsVision: true },
  { id: "openai:o3-mini", provider: "openai", label: "o3 mini", apiModel: "o3-mini", contextWindow: 200000, supportsTools: true, supportsVision: false },

  // Anthropic
  { id: "anthropic:claude-sonnet-4-5", provider: "anthropic", label: "Claude Sonnet 4.5", apiModel: "claude-sonnet-4-5", contextWindow: 200000, supportsTools: true, supportsVision: true },
  { id: "anthropic:claude-haiku-4-5", provider: "anthropic", label: "Claude Haiku 4.5", apiModel: "claude-haiku-4-5", contextWindow: 200000, supportsTools: true, supportsVision: true },
  { id: "anthropic:claude-opus-4", provider: "anthropic", label: "Claude Opus 4", apiModel: "claude-opus-4", contextWindow: 200000, supportsTools: true, supportsVision: true },

  // Gemini
  { id: "gemini:gemini-2.5-pro", provider: "gemini", label: "Gemini 2.5 Pro", apiModel: "gemini-2.5-pro", contextWindow: 1000000, supportsTools: true, supportsVision: true },
  { id: "gemini:gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash", apiModel: "gemini-2.5-flash", contextWindow: 1000000, supportsTools: true, supportsVision: true },

  // Local / OpenAI-compatible (Ollama, LM Studio, OpenRouter, Groq, ...)
  { id: "local:llama3.1", provider: "local", label: "Llama 3.1 (local)", apiModel: configurable("LOCAL_MODEL_NAME", "llama3.1"), contextWindow: 128000, supportsTools: true, supportsVision: false },
  { id: "local:qwen2.5", provider: "local", label: "Qwen 2.5 (local)", apiModel: "qwen2.5:7b", contextWindow: 32000, supportsTools: true, supportsVision: false },
  { id: "local:mistral", provider: "local", label: "Mistral (local)", apiModel: "mistral", contextWindow: 32000, supportsTools: true, supportsVision: false },

  // Demo (mock, clearly labelled)
  { id: "demo:assistant", provider: "demo", label: "Demo Assistant (MOCK)", apiModel: "demo-assistant", contextWindow: 32000, supportsTools: false, supportsVision: false, mock: true },
];

function configurable(key: string, fallback: string): string {
  return (process.env[key] as string | undefined) || fallback;
}

export function catalogForProvider(provider: string): ModelInfo[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

export function lookupModel(modelId: string | null | undefined): ModelInfo | undefined {
  if (!modelId) return undefined;
  return MODEL_CATALOG.find((m) => m.id === modelId);
}
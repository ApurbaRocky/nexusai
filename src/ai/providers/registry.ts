/**
 * AI provider registry — constructs providers, resolves which models are
 * available to a user (server key / user key / local / demo), and lets the
 * model router pick concrete providers.
 */
import type { AIProvider, ModelInfo, ProviderId } from "@/ai/providers/base";
import { OpenAICompatibleProvider } from "@/ai/providers/openai";
import { AnthropicProvider } from "@/ai/providers/anthropic";
import { GeminiProvider } from "@/ai/providers/gemini";
import { LocalModelProvider } from "@/ai/providers/local";
import { DemoProvider } from "@/ai/providers/demo";
import { MODEL_CATALOG } from "@/ai/model-catalog";
import { getServerApiKey, getUserApiKey, type ProviderKeySource } from "@/security/api-key-resolver";
import { config } from "@/config";

export function providerLabel(id: ProviderId): string {
  switch (id) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "gemini":
      return "Google Gemini";
    case "local":
      return "Local Models";
    case "demo":
      return "Demo (MOCK)";
  }
}

function buildProvider(id: Exclude<ProviderId, "demo">, apiKey?: string): AIProvider {
  switch (id) {
    case "openai":
      return new OpenAICompatibleProvider({
        id: "openai",
        label: "OpenAI",
        apiKey: apiKey ?? config.OPENAI_API_KEY,
        baseUrl: config.OPENAI_BASE_URL || "https://api.openai.com/v1",
        models: MODEL_CATALOG.filter((m) => m.provider === "openai").map(toModel),
      });
    case "anthropic":
      return new AnthropicProvider({
        apiKey: apiKey ?? config.ANTHROPIC_API_KEY,
        models: MODEL_CATALOG.filter((m) => m.provider === "anthropic").map(toModel),
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: apiKey ?? config.GOOGLE_AI_API_KEY,
        models: MODEL_CATALOG.filter((m) => m.provider === "gemini").map(toModel),
      });
    case "local":
      return new LocalModelProvider();
  }
}

function toModel(m: ModelInfo): ModelInfo {
  const serverKeyFor = (provider: string) => {
    if (provider === "local") return "none" as ProviderKeySource;
    return (getServerApiKey(m.provider) ? "server" : "none") as ProviderKeySource;
  };
  return { ...m, keySource: serverKeyFor(m.provider) };
}

/** Get a provider instance. Pass a user-provided API key to override server key. */
export function getProvider(id: ProviderId, apiKey?: string): AIProvider {
  if (id === "demo") {
    if (!config.ENABLE_DEMO_MODE) throw new Error("Demo provider is disabled.");
    return new DemoProvider();
  }
  return buildProvider(id, apiKey);
}

export function isDemoEnabled(): boolean {
  return config.ENABLE_DEMO_MODE;
}

/**
 * The list of models selectable by the user, with per-user key resolution.
 * Models without any key are marked unavailable so the UI can show them greyed.
 */
export async function getAvailableModels(userId: string): Promise<(ModelInfo & { available: boolean; reason?: string })[]> {
  const userKeys: Partial<Record<ProviderId, string>> = {};
  for (const p of ["openai", "anthropic", "gemini", "local", "demo"] as ProviderId[]) {
    if (p === "local" || p === "demo") continue;
    const key = await getUserApiKey(userId, p);
    if (key) userKeys[p] = key;
  }

  return MODEL_CATALOG.map((m) => {
    if (m.provider === "demo") {
      if (!config.ENABLE_DEMO_MODE) return { ...m, available: false, reason: "Demo mode is disabled." };
      return { ...m, available: true };
    }
    if (m.provider === "local") return { ...m, available: true };
    const key = userKeys[m.provider] ?? getServerApiKey(m.provider);
    const available = Boolean(key);
    return {
      ...m,
      available,
      reason: available ? undefined : `Add a ${providerLabel(m.provider)} API key in Settings → API keys.`,
      keySource: key ? (userKeys[m.provider] ? "user" : "server") : "none",
    };
  });
}
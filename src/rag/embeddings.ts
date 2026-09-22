/**
 * Embeddings provider adapter. Uses the configured AI provider for real
 * embeddings. When no embedding-capable provider is configured, falls back to
 * a LOCAL deterministic hashing adapter — clearly labelled as a dev-only
 * semantic similarity approximation, never presented as an AI embedding model.
 */
import { config } from "@/config";

export type EmbeddingProviderKind = "openai" | "gemini" | "local" | "none";

export interface EmbeddingProvider {
  readonly kind: EmbeddingProviderKind;
  embed(texts: string[]): Promise<number[][]>;
  readonly dimension: number;
}

class NoneEmbeddingProvider implements EmbeddingProvider {
  readonly kind = "none" as const;
  readonly dimension = 256;
  async embed(texts: string[]) {
    return texts.map(localHashEmbedding);
  }
}

/** Local dev-only hashing embedding (count-vector with hashing trick). */
export function localHashEmbedding(text: string, dimension = 256): number[] {
  const vec = new Array<number>(dimension).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9\u0980-\u09FF]+/).filter(Boolean);
  let seed = 0x811c9dc5;
  for (const tok of tokens.slice(0, 2000)) {
    seed = 0;
    for (let i = 0; i < tok.length; i++) seed = ((seed << 5) - seed + tok.charCodeAt(i)) | 0;
    const h = Math.abs(seed + 0x9e3779b9);
    vec[h % dimension] += (h >> 30) & 1 ? 1 : 0; // signed-feature hashing
  }
  return normalizeL2(vec);
}

export function normalizeL2(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

/** Resolve the active embedding provider from env config. */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  const mode = config.EMBEDDING_PROVIDER ?? "none";

  // OpenAI-compatible (works for OpenAI cloud + local LM Studio/Ollama).
  if (mode === "openai" && config.OPENAI_API_KEY) {
    return import("@/ai/providers/openai").then(({ OpenAICompatibleProvider }) => {
      const p = new OpenAICompatibleProvider({
        id: "openai",
        label: "OpenAI",
        apiKey: config.OPENAI_API_KEY,
        baseUrl: config.OPENAI_BASE_URL || "https://api.openai.com/v1",
        models: [],
      });
      return {
        kind: "openai" as const,
        dimension: 1536,
        embed: async (texts: string[]) => {
          const out: number[][] = [];
          for (let i = 0; i < texts.length; i += 96) {
            const batch = texts.slice(i, i + 96);
            out.push(...(await p.embed(batch, config.EMBEDDING_MODEL ?? "text-embedding-3-small")));
          }
          return out;
        },
      };
    });
  }

  // Local endpoint embeddings via OpenAI-compatible embed route.
  if (mode === "local" && config.LOCAL_MODEL_BASE_URL) {
    return import("@/ai/providers/openai").then(({ OpenAICompatibleProvider }) => {
      const p = new OpenAICompatibleProvider({
        id: "local",
        label: "Local Embeddings",
        apiKey: "",
        baseUrl: config.LOCAL_MODEL_BASE_URL,
        models: [],
      });
      return {
        kind: "local" as const,
        dimension: 768,
        embed: async (texts: string[]) => p.embed(texts, config.EMBEDDING_MODEL ?? "nomic-embed-text"),
      };
    });
  }

  return new NoneEmbeddingProvider();
}
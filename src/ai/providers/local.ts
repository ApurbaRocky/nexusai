/**
 * Local model provider — OpenAI-compatible endpoints (Ollama, LM Studio,
 * vLLM, llama.cpp server, ...). Defaults to Ollama at localhost:11434.
 */
import { OpenAICompatibleProvider } from "@/ai/providers/openai";
import { catalogForProvider } from "@/ai/model-catalog";
import { config } from "@/config";

export class LocalModelProvider extends OpenAICompatibleProvider {
  readonly id = "local" as const;

  constructor() {
    super({
      id: "local",
      label: "Local Models",
      baseUrl: config.LOCAL_MODEL_BASE_URL || "http://localhost:11434/v1",
      apiKey: "",
      models: catalogForProvider("local").map((m) => ({
        ...m,
        keySource: "none", // local endpoints usually need no auth
      })),
    });
  }
}
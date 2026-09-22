/**
 * MOCK provider — for local development and UI testing only.
 * Clearly labelled end-to-end (model label, banner, response footer).
 * Enabled exclusively by ENABLE_DEMO_MODE=true. Never used in production;
 * the registry refuses to serve it otherwise.
 */
import type { AIProvider, ChatParams, ModelInfo, ProviderStreamEvent } from "@/ai/providers/base";
import { catalogForProvider } from "@/ai/model-catalog";

const SENTENCES = [
  "This is the AI Nexus demo provider (MOCK data).",
  "No real AI model was called to produce this response.",
  "It exists so you can test the chat UI, streaming, and layout without API keys.",
];

export class DemoProvider implements AIProvider {
  readonly id = "demo" as const;
  readonly label = "Demo (MOCK)";
  readonly models: ModelInfo[] = catalogForProvider("demo").map((m) => ({ ...m, keySource: "none", mock: true }));

  listModels() {
    return this.models;
  }
  isConfigured() {
    return true;
  }

  async *streamChat(params: ChatParams): AsyncIterable<ProviderStreamEvent> {
    const lastUser = [...params.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const reply = [
      `**Demo response (MOCK — not a real AI).**`,
      ``,
      `You asked: “${lastUser.slice(0, 200)}”`,
      ``,
      ...SENTENCES,
      ``,
      `You selected model “${params.model.label}”. Streaming, markdown, and UI pipes are all working.`,
      ``,
      `> Demo mode can be disabled by setting \`ENABLE_DEMO_MODE=false\` and adding a real provider key.`,
    ].join("\n");

    // Simulated token stream to exercise the client rendering path.
    const chunks = reply.split(/(?<=[\s。.!?])\s*/);
    for (const chunk of chunks) {
      await new Promise((r) => setTimeout(r, 12));
      yield { type: "text_delta", content: chunk + " " };
    }
    yield { type: "usage", promptTokens: lastUser.length / 4, completionTokens: reply.length / 4, totalTokens: Math.round((lastUser.length + reply.length) / 4) };
    yield { type: "done" };
  }

  async complete(params: ChatParams): Promise<{ content: string }> {
    let content = "";
    for await (const ev of this.streamChat(params)) {
      if (ev.type === "text_delta") content += ev.content;
    }
    return { content };
  }
}
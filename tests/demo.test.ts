import { describe, expect, it } from "vitest";
import { DemoProvider } from "@/ai/providers/demo";
import { lookupModel } from "@/ai/model-catalog";

describe("demo provider (MOCK)", () => {
  it("is always configured and clearly labelled", () => {
    const p = new DemoProvider();
    expect(p.isConfigured()).toBe(true);
    expect(p.label).toContain("MOCK");
    expect(p.listModels().every((m) => m.mock)).toBe(true);
  });

  it("streams a markdown reply that references the demo banner", async () => {
    const p = new DemoProvider();
    const model = lookupModel("demo:assistant")!;
    const chunks: string[] = [];
    for await (const ev of p.streamChat({ messages: [{ role: "user", content: "hello" }], model })) {
      if (ev.type === "text_delta") chunks.push(ev.content);
      if (ev.type === "usage") expect(ev.completionTokens).toBeGreaterThan(0);
    }
    const full = chunks.join("").replace(/\s+/g, " ");
    expect(full).toContain("Demo response");
    expect(full).toContain("MOCK");
  });
});
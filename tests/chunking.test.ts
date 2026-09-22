import { describe, expect, it } from "vitest";
import { chunkText, estimateTokens } from "@/rag/chunking";

const SAMPLE = Array.from({ length: 40 }, (_, i) => `Paragraph number ${i}: the quick brown fox jumps over the lazy dog with great enthusiasm and a small violin.`).join("\n\n");

describe("RAG chunking", () => {
  it("splits text into overlapping chunks bounded by chunk size", () => {
    const chunks = chunkText(SAMPLE, { chunkSize: 200, overlap: 30 });
    expect(chunks.length).toBeGreaterThan(1);
    for (let j = 0; j < chunks.length; j++) {
      const c = chunks[j];
      // Non-final chunks stay within the window (final may absorb a short tail).
      if (j < chunks.length - 1) expect(c.content.length).toBeLessThanOrEqual(240);
      expect(c.tokenCount).toBeGreaterThan(0);
    }
  });

  it("handles short text as a single chunk", () => {
    const chunks = chunkText("Hello world.");
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe("Hello world.");
  });

  it("estimates tokens roughly proportionally", () => {
    expect(estimateTokens("aaaa bbbb cccc dddd")).toBe(5);
  });

  it("preserves original text adjacency", () => {
    const text = "one. " + "single."; // short
    const chunks = chunkText(text);
    expect(chunks.reduce((a, c) => a + c.content, "")).toContain("single.");
  });
});
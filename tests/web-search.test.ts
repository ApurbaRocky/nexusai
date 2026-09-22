import { describe, expect, it } from "vitest";
import { MockSearchAdapter } from "@/tools/tools/web-search";

describe("web search (mock provider)", () => {
  it("returns titled results with URLs for a query", async () => {
    const adapter = new MockSearchAdapter();
    const results = await adapter.search("RAG enterprise", 5);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.url).toMatch(/^https?:\/\//);
      expect(r.provider).toBe("mock");
    }
  });

  it("respects the requested count", async () => {
    const adapter = new MockSearchAdapter();
    const results = await adapter.search("test", 1);
    expect(results.length).toBe(1);
  });
});
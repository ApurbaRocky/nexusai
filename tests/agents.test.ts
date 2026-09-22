import { describe, expect, it } from "vitest";
import { classifyRequest, listAgents } from "@/agents/agents/registry";
import { settingsSchema } from "@/security/validate";

describe("profile settings validation", () => {
  it("accepts a display name update when saving settings", () => {
    const parsed = settingsSchema.safeParse({ name: "Alice Example" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Alice Example");
    }
  });
});

describe("agent registry + classifier", () => {
  it("exposes all six built-in agents", () => {
    const agents = listAgents();
    const ids = agents.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["assistant", "research", "education", "security", "coding", "document"]));
  });

  it("classifies research questions to the research agent", () => {
    const result = classifyRequest("Compare Qwen2.5 and Llama 3.1 for medical RAG", {});
    expect(result.agentId).toBe("research");
  });

  it("classifies HOW/implement questions to the coding agent", () => {
    const result = classifyRequest("How do I implement a binary tree in TypeScript?", {});
    expect(result.agentId).toBe("coding");
  });

  it("classifies security queries to the security agent", () => {
    const result = classifyRequest("What are common OWASP Top 10 risks and how do I audit my API?", {});
    expect(result.agentId).toBe("security");
  });

  it("falls back to the assistant agent for generic chatter", () => {
    const result = classifyRequest("Hi! How are you today?", {});
    expect(result.agentId).toBe("assistant");
  });
});
/**
 * Education Explain Tool (LOW risk)
 * Generates educational explanations at different levels.
 */
import { z } from "zod";
import type { ToolDef, ToolOutput, ToolContext } from "@/tools/types";
import { generateExplanation } from "@/agents/education/explanation-engine";

const inputSchema = z.object({
  topic: z.string().min(1).max(500).describe("Topic to explain"),
  level: z.enum(["beginner", "intermediate", "advanced"]).default("intermediate").describe("Explanation level"),
  mode: z.enum(["simple", "deep", "example", "exam", "notes"]).default("deep").describe("Explanation mode"),
  language: z.enum(["en", "bn", "mixed"]).default("en").describe("Response language"),
  documentIds: z.array(z.string()).optional().describe("Document IDs to use as sources"),
});

export const educationExplainTool: ToolDef<typeof inputSchema> = {
  name: "education_explain",
  description: "Generate educational explanations at different levels with citations from documents.",
  inputSchema,
  riskLevel: "low",
  async execute({ topic, level, mode, language, documentIds }, ctx: ToolContext): Promise<ToolOutput> {
    const result = await generateExplanation(
      { topic, level, mode, language, documentIds },
      ctx.userId
    );

    let content = `# Explanation: ${topic}\n\n`;
    content += `**Level:** ${level} | **Mode:** ${mode} | **Language:** ${language}\n\n`;
    content += result.explanation;

    if (result.keyPoints.length > 0) {
      content += "\n\n## Key Points\n";
      result.keyPoints.forEach((p, i) => { content += `${i + 1}. ${p}\n`; });
    }

    if (result.examples.length > 0) {
      content += "\n\n## Examples\n";
      result.examples.forEach((e, i) => { content += `${i + 1}. ${e}\n`; });
    }

    if (result.citations.length > 0) {
      content += "\n\n## Sources\n";
      result.citations.forEach((c, i) => {
        content += `[${i + 1}] ${c.documentTitle}${c.pageNumber ? ` (page ${c.pageNumber})` : ""}: ${c.excerpt.slice(0, 150)}...\n`;
      });
    }

    return {
      content,
      data: result,
    };
  },
};
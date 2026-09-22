/**
 * Answer Evaluator Tool (LOW risk)
 * Evaluates student answers with detailed feedback.
 */
import { z } from "zod";
import type { ToolDef, ToolOutput, ToolContext } from "@/tools/types";
import { evaluateAnswer } from "@/agents/education/answer-evaluator";

const inputSchema = z.object({
  question: z.string().min(1).max(5000).describe("The question that was asked"),
  userAnswer: z.string().min(1).max(10000).describe("Student's answer"),
  expectedAnswer: z.string().optional().describe("Expected/model answer for reference"),
  markingScheme: z.string().optional().describe("Marking scheme/rubric"),
  totalMarks: z.number().int().positive().max(100).default(10).describe("Total marks available"),
  language: z.enum(["en", "bn", "mixed"]).default("en").describe("Evaluation language"),
});

export const evaluateAnswerTool: ToolDef<typeof inputSchema> = {
  name: "evaluate_answer",
  description: "Evaluate student answers with detailed feedback and scoring.",
  inputSchema,
  riskLevel: "low",
  async execute({ question, userAnswer, expectedAnswer, markingScheme, totalMarks, language }, ctx: ToolContext): Promise<ToolOutput> {
    const result = await evaluateAnswer(
      { question, userAnswer, expectedAnswer, markingScheme, totalMarks, language },
      ctx.userId
    );

    let content = `# Answer Evaluation\n\n`;
    content += `**Question:** ${question}\n\n`;
    content += `**Your Answer:** ${userAnswer}\n\n`;
    content += `## Score: ${result.score}/${result.maxScore}\n\n`;

    if (result.feedback.strengths.length > 0) {
      content += `## ✅ Strengths\n`;
      result.feedback.strengths.forEach((s) => { content += `- ${s}\n`; });
      content += "\n";
    }

    if (result.feedback.weaknesses.length > 0) {
      content += `## ⚠️ Areas for Improvement\n`;
      result.feedback.weaknesses.forEach((w) => { content += `- ${w}\n`; });
      content += "\n";
    }

    if (result.feedback.missingPoints.length > 0) {
      content += `## 📝 Missing Points\n`;
      result.feedback.missingPoints.forEach((m) => { content += `- ${m}\n`; });
      content += "\n";
    }

    if (result.feedback.improvements.length > 0) {
      content += `## 💡 Suggested Improvements\n`;
      result.feedback.improvements.forEach((i) => { content += `- ${i}\n`; });
      content += "\n";
    }

    if (result.idealAnswer) {
      content += `## 📋 Ideal Answer\n${result.idealAnswer}\n\n`;
    }

    if (result.keyPoints.length > 0) {
      content += `## 🔑 Key Points\n`;
      result.keyPoints.forEach((k, i) => { content += `${i + 1}. ${k}\n`; });
    }

    return {
      content,
      data: result,
    };
  },
};
/**
 * Question Generator Tool (LOW risk)
 * Generates educational questions of various types.
 */
import { z } from "zod";
import type { ToolDef, ToolOutput, ToolContext } from "@/tools/types";
import { generateQuestions } from "@/agents/education/question-generator";

const inputSchema = z.object({
  topic: z.string().min(1).max(500).describe("Topic for questions"),
  count: z.number().int().min(1).max(50).default(10).describe("Number of questions"),
  type: z.enum(["mcq", "true_false", "fill_blank", "short", "long", "viva", "matching", "case_based"]).default("mcq").describe("Question type"),
  difficulty: z.enum(["easy", "medium", "hard", "university"]).default("medium").describe("Difficulty level"),
  language: z.enum(["en", "bn", "mixed"]).default("en").describe("Response language"),
  subjectId: z.string().optional().describe("Subject ID to scope questions"),
  topicId: z.string().optional().describe("Topic ID to scope questions"),
  documentIds: z.array(z.string()).optional().describe("Document IDs to use as sources"),
  examMarks: z.enum(["1", "2", "3", "5", "10", "15"]).optional().describe("Exam marks format"),
});

const parseExamMarks = (value?: string) => {
  if (!value) return undefined;
  const numeric = Number(value);
  if ([1, 2, 3, 5, 10, 15].includes(numeric)) {
    return numeric as 1 | 2 | 3 | 5 | 10 | 15;
  }
  return undefined;
};

export const questionGeneratorTool: ToolDef<typeof inputSchema> = {
  name: "question_generator",
  description: "Generate educational questions of various types with validation.",
  inputSchema,
  riskLevel: "low",
  async execute({ topic, count, type, difficulty, language, subjectId, topicId, documentIds, examMarks }, ctx: ToolContext): Promise<ToolOutput> {
    const result = await generateQuestions(
      { topic, count, type, difficulty, language, subjectId, topicId, documentIds, examMarks: parseExamMarks(examMarks) },
      ctx.userId
    );

    let content = `# Generated Questions: ${topic}\n\n`;
    content += `**Type:** ${type} | **Count:** ${result.questions.length} | **Difficulty:** ${difficulty}\n\n`;

    result.questions.forEach((q, i) => {
      content += `## ${i + 1}. ${q.question}\n\n`;
      if (q.options && q.options.length > 0) {
        content += "**Options:**\n";
        q.options.forEach((opt) => {
          content += `- ${opt.label}: ${opt.text}\n`;
        });
        content += "\n";
      }
      content += `**Correct Answer:** ${q.correctAnswer}\n\n`;
      content += `**Explanation:** ${q.explanation}\n\n`;
      if (q.explanation) {
        content += `---\n\n`;
      }
    });

    return {
      content,
      data: result,
    };
  },
};
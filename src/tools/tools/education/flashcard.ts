/**
 * Flashcard Tool (LOW risk)
 * Generates and manages flashcards for spaced repetition.
 */
import { z } from "zod";
import type { ToolDef, ToolOutput, ToolContext } from "@/tools/types";
import { generateFlashcards, getDueFlashcards, scheduleFlashcardReview } from "@/agents/education/flashcard-generator";

const generateSchema = z.object({
  action: z.literal("generate"),
  count: z.number().int().min(1).max(100).default(20).describe("Number of flashcards"),
  subjectId: z.string().optional().describe("Subject ID"),
  topicId: z.string().optional().describe("Topic ID"),
  documentIds: z.array(z.string()).optional().describe("Document IDs to use as sources"),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium").describe("Difficulty level"),
  language: z.enum(["en", "bn", "mixed"]).default("en").describe("Language"),
});

const dueSchema = z.object({
  action: z.literal("due"),
  limit: z.number().int().positive().max(100).default(50).describe("Number of due cards"),
});

const reviewSchema = z.object({
  action: z.literal("review"),
  flashcardId: z.string().describe("Flashcard ID"),
  rating: z.enum(["1", "2", "3", "4"]).describe("Rating: 1=Again, 2=Hard, 3=Good, 4=Easy"),
});

const inputSchema = z.discriminatedUnion("action", [generateSchema, dueSchema, reviewSchema]);

type FlashcardParams = z.infer<typeof inputSchema>;

async function handleGenerate(params: z.infer<typeof generateSchema>, ctx: ToolContext): Promise<ToolOutput> {
  const result = await generateFlashcards(
    {

      count: params.count,
      subjectId: params.subjectId,
      topicId: params.topicId,
      documentIds: params.documentIds,
      difficulty: params.difficulty,
      language: params.language,
    },
    ctx.userId
  );

  let content = `# Generated Flashcards\n\n`;
  content += `**Count:** ${result.flashcards.length} | **Difficulty:** ${params.difficulty} | **Language:** ${params.language}\n\n`;

  result.flashcards.forEach((fc, i) => {
    content += `## ${i + 1}. ${fc.front}\n\n`;
    content += `**Answer:** ${fc.back}\n\n`;
    content += `*Difficulty: ${fc.difficulty} | Tags: ${fc.tags?.join(", ") || "none"}*\n\n`;
    content += "---\n\n";
  });

  return { content, data: result };
}

async function handleDue(params: z.infer<typeof dueSchema>, ctx: ToolContext): Promise<ToolOutput> {
  const result = await getDueFlashcards(ctx.userId, params.limit);

  let content = `# Due Flashcards (${result.total} total)\n\n`;
  content += `**Showing:** ${result.due.length} cards due for review\n\n`;

  result.due.forEach((fc, i) => {
    content += `## ${i + 1}. ${fc.front}\n\n`;
    content += `**Answer:** ${fc.back}\n\n`;
    content += `*ID: ${fc.id}*\n\n`;
    content += "---\n\n";
  });

  return { content, data: { due: result.due, total: result.total } };
}

async function handleReview(params: z.infer<typeof reviewSchema>, ctx: ToolContext): Promise<ToolOutput> {
  const result = await scheduleFlashcardReview(
    params.flashcardId,
    ctx.userId,
    parseInt(params.rating) as 1 | 2 | 3 | 4
  );

  const ratingLabels = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

  let content = `# Flashcard Reviewed\n\n`;
  content += `**Rating:** ${ratingLabels[parseInt(params.rating) as 1 | 2 | 3 | 4]}\n`;
  content += `**Next Review:** ${result.nextReviewAt.toLocaleDateString()} (in ${result.interval} days)\n`;
  content += `**Ease Factor:** ${result.easeFactor.toFixed(2)}\n`;
  content += `**Repetitions:** ${result.repetitions}\n`;

  return { content, data: result };
}

export const flashcardTool: ToolDef<typeof inputSchema> = {
  name: "flashcard",
  description: "Generate and manage flashcards for spaced repetition learning.",
  inputSchema,
  riskLevel: "low",
  async execute(params: FlashcardParams, ctx: ToolContext): Promise<ToolOutput> {
    if (params.action === "generate") return handleGenerate(params, ctx);
    if (params.action === "due") return handleDue(params, ctx);
    if (params.action === "review") return handleReview(params, ctx);
    throw new Error("Invalid flashcard action");
  },
};
/**
 * Quiz Tool (LOW risk)
 * Starts and manages interactive quiz sessions.
 */
import { z } from "zod";
import type { ToolDef, ToolOutput, ToolContext } from "@/tools/types";
import { startQuiz, answerQuizQuestion, getQuizProgress } from "@/agents/education/quiz-engine";

const startSchema = z.object({
  action: z.literal("start"),
  subjectId: z.string().optional().describe("Subject ID"),
  topicId: z.string().optional().describe("Topic ID"),
  name: z.string().default("Practice Quiz").describe("Quiz name"),
  questionCount: z.number().int().min(1).max(50).default(10).describe("Number of questions"),
  timeLimit: z.number().int().positive().optional().describe("Time limit in seconds"),
  difficulty: z.enum(["easy", "medium", "hard", "university"]).optional().describe("Difficulty filter"),
  questionTypes: z.array(z.enum(["mcq", "true_false", "fill_blank", "short", "long", "viva", "matching", "case_based"])).optional().describe("Question types"),
  shuffleQuestions: z.boolean().default(true).describe("Shuffle questions"),
  shuffleOptions: z.boolean().default(true).describe("Shuffle options"),
});

const answerSchema = z.object({
  action: z.literal("answer"),
  sessionId: z.string().describe("Quiz session ID"),
  questionId: z.string().describe("Question ID"),
  answer: z.string().describe("User's answer"),
  timeSpent: z.number().int().positive().optional().describe("Time spent in milliseconds"),
});

const progressSchema = z.object({
  action: z.literal("progress"),
  sessionId: z.string().describe("Quiz session ID"),
});

const inputSchema = z.discriminatedUnion("action", [startSchema, answerSchema, progressSchema]);

export const quizTool: ToolDef<typeof inputSchema> = {
  name: "quiz",
  description: "Start and manage interactive quiz sessions with adaptive difficulty.",
  inputSchema,
  riskLevel: "low",
  async execute(params, ctx: ToolContext): Promise<ToolOutput> {
    if (params.action === "start") {
      const result = await startQuiz(
        ctx.userId,
        params.subjectId,
        params.topicId,
        params.name,
        params.questionCount,
        {
          timeLimit: params.timeLimit,
          difficulty: params.difficulty,
          questionTypes: params.questionTypes,
          shuffleQuestions: params.shuffleQuestions,
          shuffleOptions: params.shuffleOptions,
        }
      );

      let content = `# Quiz Started: ${params.name}\n\n`;
      content += `**Session ID:** ${result.sessionId}\n`;
      content += `**Total Questions:** ${result.firstQuestion.total}\n\n`;
      content += `## Question ${result.firstQuestion.index + 1}/${result.firstQuestion.total}\n\n`;
      content += `**${result.firstQuestion.question}**\n\n`;
      if (result.firstQuestion.options) {
        result.firstQuestion.options.forEach((opt) => {
          content += `- ${opt.label}: ${opt.text}\n`;
        });
      }
      if (result.firstQuestion.timeRemaining) {
        content += `\n⏱ Time remaining: ${result.firstQuestion.timeRemaining}s\n`;
      }

      return {
        content,
        data: result,
      };
    }

    if (params.action === "answer") {
      const result = await answerQuizQuestion(
        params.sessionId,
        ctx.userId,
        params.questionId,
        params.answer,
        params.timeSpent
      );

      let content = result.isCorrect ? "✅ **Correct!**" : "❌ **Incorrect**";
      content += `\n\n`;
      if (!result.isCorrect) {
        content += `**Correct Answer:** ${result.correctAnswer}\n\n`;
      }
      if (result.explanation) {
        content += `**Explanation:** ${result.explanation}\n\n`;
      }
      content += `**Score:** ${result.score}/${result.completed ? "Final" : "In Progress"}\n`;

      if (result.nextQuestion) {
        content += `\n## Next Question (${result.nextQuestion.index + 1}/${result.nextQuestion.total})\n\n`;
        content += `**${result.nextQuestion.question}**\n\n`;
        if (result.nextQuestion.options) {
          result.nextQuestion.options.forEach((opt) => {
            content += `- ${opt.label}: ${opt.text}\n`;
          });
        }
      } else if (result.completed) {
        content += `\n🎉 **Quiz Completed!**\n`;
        content += `**Final Score:** ${result.finalScore ?? result.score}\n`;
      }

      return {
        content,
        data: result,
      };
    }

    if (params.action === "progress") {
      const progress = await getQuizProgress(params.sessionId, ctx.userId);

      let content = `# Quiz Progress\n\n`;
      content += `**Session:** ${progress.session.name}\n`;
      content += `**Progress:** ${progress.session.currentIndex}/${progress.session.totalQuestions} (${progress.progress.toFixed(1)}%)\n`;
      content += `**Score:** ${progress.session.score}/${progress.session.totalQuestions}\n`;
      content += `**Status:** ${progress.session.status}\n`;

      if (progress.currentQuestion) {
        content += `\n## Current Question (${progress.currentQuestion.index + 1}/${progress.currentQuestion.total})\n\n`;
        content += `**${progress.currentQuestion.question}**\n\n`;
        if (progress.currentQuestion.options) {
          progress.currentQuestion.options.forEach((opt) => {
            content += `- ${opt.label}: ${opt.text}\n`;
          });
        }
      }

      return {
        content,
        data: progress,
      };
    }

    throw new Error("Invalid quiz action");
  },
};
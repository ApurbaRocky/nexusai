/**
 * Education Agent (Phase 4)
 * Main entry point for the Education Agent functionality.
 * Re-exports all education agent functionality from specialized modules.
 */
import { generateExplanation } from "@/agents/education/explanation-engine";
import { generateQuestions } from "@/agents/education/question-generator";
import { startQuiz, answerQuizQuestion, getQuizProgress } from "@/agents/education/quiz-engine";
import { evaluateAnswer } from "@/agents/education/answer-evaluator";
import { generateFlashcards, getDueFlashcards, scheduleFlashcardReview } from "@/agents/education/flashcard-generator";
import { generateStudyPlan, getStudyPlan, updateStudyPlanProgress } from "@/agents/education/study-planner";
import { getUserProgress, updateProgressFromQuiz, detectWeakTopics, getRecentActivity } from "@/agents/education/progress-tracker";
import { retrieveContext } from "@/rag/service";
import type {
  EducationChatRequest,
  EducationChatResponse,
  EducationAction,
  EducationMode,
  Language,
  ExplanationLevel,
  EducationCitation,
} from "@/agents/education/education-types";
import type { ProviderStreamEvent, AIProvider } from "@/ai/providers/base";

export async function* educationChat(
  input: EducationChatRequest,
  userId: string,
  requestId: string
): AsyncGenerator<ProviderStreamEvent, EducationChatResponse, void> {
  const mode = input.mode;
  const context = input.context || {};
  const language = context.language ?? "en";

  const { resolveKeySource } = await import("@/security/api-key-resolver");
  const { lookupModel } = await import("@/ai/model-catalog");
  const { getProvider } = await import("@/ai/providers/registry");

  const key = await resolveKeySource(userId, "openai");
  const model = lookupModel("openai:gpt-4o-mini");
  const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

  if (!provider || !model) {
    throw new Error("Education agent requires an OpenAI-compatible provider");
  }

  let citations: EducationCitation[] = [];
  let ragContext = "";

  if (context.documentIds && context.documentIds.length > 0) {
    const ragResult = await retrieveContext(input.message, {
      documentIds: context.documentIds,
      topK: 5,
    });

    if (ragResult.length > 0) {
      ragContext = ragResult
        .map((c, i) => `[${i + 1}] Source: "${c.filename}"${c.page ? ` (page ${c.page})` : ""}\n${c.content}`)
        .join("\n\n---\n\n");

      citations = ragResult.map((c) => ({
        documentId: c.documentId,
        documentTitle: c.filename,
        pageNumber: c.page,
        excerpt: c.content.slice(0, 200),
      }));
    }
  }

  const systemPrompt = buildEducationSystemPrompt(mode, language, ragContext, context.level);
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: input.message },
  ];

  let fullText = "";
  let usage: { promptTokens?: number; completionTokens?: number } = {};

  const providerTyped = provider as AIProvider;
  for await (const event of providerTyped.streamChat({ model, messages, apiKey: key.apiKey })) {
    switch (event.type) {
      case "text_delta":
        fullText += event.content;
        yield { id: crypto.randomUUID(), type: "text_delta", content: event.content };
        break;
      case "reasoning_delta":
        yield { id: crypto.randomUUID(), type: "reasoning_delta", content: event.content };
        break;
      case "tool_call":
        yield { id: crypto.randomUUID(), type: "tool_call", call: event.call };
        break;
      case "tool_call_delta":
        break;
      case "source":
        citations.push({
          documentId: event.source.documentId ?? event.source.sourceId ?? event.source.id ?? "unknown",
          documentTitle: event.source.title ?? "Unknown source",
          pageNumber: event.source.page,
          excerpt: event.source.snippet ?? "",
        });
        yield { id: crypto.randomUUID(), type: "source", source: event.source };
        break;
      case "usage":
        usage = {
          promptTokens: event.promptTokens ?? usage.promptTokens,
          completionTokens: event.completionTokens ?? usage.completionTokens,
        };
        yield { id: crypto.randomUUID(), type: "usage", promptTokens: event.promptTokens, completionTokens: event.completionTokens, totalTokens: (event.promptTokens ?? 0) + (event.completionTokens ?? 0) };
        break;
      case "done":
        break;
    }
  }

  const suggestedActions = getSuggestedActions(mode);

  yield { id: crypto.randomUUID(), type: "done", messageId: requestId, conversationId: "education" };

  return {
    response: fullText,
    citations,
    suggestedActions,
  };
}

function buildEducationSystemPrompt(
  mode: EducationMode,
  language: Language,
  ragContext: string,
  level?: ExplanationLevel
): string {
  const basePrompt = `You are an expert Education Agent for AI Nexus. Your role is to teach, explain, and help students learn effectively.

CORE PRINCIPLES:
- Adapt to the student's level (${level ?? "intermediate"}) and language (${language === "bn" ? "Bengali" : language === "mixed" ? "Mixed Bengali-English" : "English"})
- Use clear structure with headings, bullet points, and examples
- Distinguish between document-based knowledge and general knowledge
- Cite sources when using document content: [1], [2]
- Encourage active learning with questions and practice
- Never fabricate information from documents

CURRENT MODE: ${getModeDescription(mode)}

${ragContext ? `DOCUMENT CONTEXT (use for citations):\n${ragContext}\n\n` : ""}`;

  return basePrompt;
}

function getModeDescription(mode: EducationMode): string {
  switch (mode) {
    case "learn":
      return "LEARN MODE: Explain concepts clearly with analogies, examples, and progressive depth.";
    case "exam":
      return "EXAM MODE: Provide structured, exam-ready answers with definitions, key points, and marking schemes.";
    case "practice":
      return "PRACTICE MODE: Generate questions and guide through practice with feedback.";
    case "test":
      return "TEST MODE: Create and manage timed practice tests.";
    case "viva":
      return "VIVA MODE: Conduct interactive oral examination with follow-up questions.";
    case "flashcard":
      return "FLASHCARD MODE: Create and manage flashcards for spaced repetition.";
    case "study_plan":
      return "STUDY PLAN MODE: Create personalized study schedules and track progress.";
    default:
      return "GENERAL EDUCATION MODE: Adapt to the student's needs.";
  }
}

function getSuggestedActions(mode: EducationMode): EducationAction[] {
  const actions: EducationAction[] = [];

  switch (mode) {
    case "learn":
      actions.push(
        { type: "explain", label: "Explain more deeply", payload: { mode: "deep" } },
        { type: "explain", label: "Give an example", payload: { mode: "example" } },
        { type: "quiz", label: "Practice questions", payload: { count: 5 } },
        { type: "flashcard", label: "Create flashcards", payload: { count: 10 } }
      );
      break;
    case "exam":
      actions.push(
        { type: "explain", label: "Simplify this answer", payload: { mode: "simple" } },
        { type: "quiz", label: "Practice similar questions", payload: { count: 5 } }
      );
      break;
    case "practice":
      actions.push(
        { type: "quiz", label: "Continue practice", payload: {} },
        { type: "evaluate", label: "Evaluate my answer", payload: {} }
      );
      break;
    case "viva":
      actions.push(
        { type: "viva", label: "Next question", payload: {} },
        { type: "evaluate", label: "Evaluate my answer", payload: {} }
      );
      break;
    case "flashcard":
      actions.push(
        { type: "flashcard", label: "Review due cards", payload: {} },
        { type: "flashcard", label: "Generate more cards", payload: { count: 10 } }
      );
      break;
    case "study_plan":
      actions.push(
        { type: "study_plan", label: "View full plan", payload: {} },
        { type: "explain", label: "Explain today's topic", payload: {} }
      );
      break;
  }

  return actions;
}

// Re-export all functions from specialized modules
export {
  generateExplanation,
  generateQuestions,
  startQuiz,
  answerQuizQuestion,
  getQuizProgress,
  evaluateAnswer,
  generateFlashcards,
  getDueFlashcards,
  scheduleFlashcardReview,
  generateStudyPlan,
  getStudyPlan,
  updateStudyPlanProgress,
  getUserProgress,
  updateProgressFromQuiz,
  detectWeakTopics,
  getRecentActivity,
};
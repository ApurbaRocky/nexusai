/**
 * Flashcard Generator (Phase 4 - Education Agent)
 * Generates flashcards from topics, documents, or questions.
 */
import { getProvider } from "@/ai/providers/registry";
import { resolveKeySource } from "@/security/api-key-resolver";
import { lookupModel } from "@/ai/model-catalog";
import { retrieveContext } from "@/rag/service";
import { prisma } from "@/database/client";
import type {
  EducationFlashcardRequest,
  EducationFlashcardGenerateResponse,
  FlashcardData,
  Language,
  Difficulty,
} from "@/agents/education/education-types";
import { log } from "@/utils/log";

const MODEL_ID = "openai:gpt-4o-mini";

const FLASHCARD_SYSTEM_PROMPT = `You are an expert educator creating high-quality flashcards for spaced repetition learning.

FLASHCARD PRINCIPLES:
1. ONE CONCEPT PER CARD - Each card tests a single fact/concept
2. QUESTION FORMAT - Front should be a clear question or prompt
3. CONCISE ANSWER - Back should be a complete but brief answer
3. ACTIVE RECALL - Front should require active retrieval, not recognition
4. ATOMIC - Break complex topics into multiple cards
5. CONTEXT - Include enough context to make the card self-contained

FLASHCARD TYPES:
- DEFINITION: "What is X?" / "X is..."
- CONCEPT: "Explain Y" / "Y is the process where..."
- COMPARISON: "Difference between A and B?" / "A does X, B does Y..."
- CAUSE/EFFECT: "What causes Z?" / "Z is caused by..."
- EXAMPLE: "Example of Q?" / "An example of Q is..."
- FORMULA/RULE: "What is the formula for...?" / "Formula: ..."
- STEP/PROCESS: "Steps in W?" / "1. ... 2. ... 3. ..."

OUTPUT FORMAT: JSON array of flashcard objects:
{
  "front": "Question/prompt",
  "back": "Complete answer with brief explanation",
  "difficulty": "easy|medium|hard",
  "tags": ["topic1", "topic2"],
  "language": "en|bn|mixed"
}

Generate cards that build understanding progressively from basic to advanced.`;

const LANGUAGE_PROMPTS: Record<Language, string> = {
  en: "Create flashcards in ENGLISH.",
  bn: "ফ্ল্যাশকার্ড তৈরি করুন বাংলা (Bengali) ভাষায়। শুদ্ধ বাংলা ব্যবহার করুন।",
  mixed: "Create flashcards in MIXED Bengali-English. Use Bengali for explanations, English for technical terms.",
};

export async function generateFlashcards(
  request: EducationFlashcardRequest,
  userId: string
): Promise<EducationFlashcardGenerateResponse> {
  const language = request.language ?? "en";
  const difficulty = request.difficulty ?? "medium";

  const key = await resolveKeySource(userId, "openai");
  const model = lookupModel(MODEL_ID);
  const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

  if (!provider || !model) {
    throw new Error("Flashcard generator requires an OpenAI-compatible provider");
  }

  let context = "";

  if (request.documentIds && request.documentIds.length > 0) {
    const ragResult = await retrieveContext(request.topicId || "all topics", {
      documentIds: request.documentIds,
      topK: 10,
    });

    if (ragResult.length > 0) {
      context = ragResult
        .map((c, i) => `[${i + 1}] Source: "${c.filename}"${c.page ? ` (page ${c.page})` : ""}\n${c.content}`)
        .join("\n\n---\n\n");
    }
  }

  const topicContext = request.topicId
    ? `\n\nFOCUS TOPIC: ${request.topicId}\nGenerate flashcards specifically about this topic.`
    : request.subjectId
    ? `\n\nSUBJECT: ${request.subjectId}\nGenerate flashcards covering key concepts from this subject.`
    : "";

  const count = request.count ?? 20;

  const systemPrompt = `${FLASHCARD_SYSTEM_PROMPT}\n${LANGUAGE_PROMPTS[language]}\n\n${context ? `Use the following source material. Cite sources using [1], [2] format:\n\n${context}\n\n` : ""}${topicContext}\n\nGenerate EXACTLY ${count} flashcards.`;

  try {
    const result = await provider.complete({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Generate ${count} flashcards.` },
      ],
      temperature: 0.5,
      maxTokens: 3000,
    });

    const flashcards = parseFlashcardsResponse(result.content, language, difficulty);
    return { flashcards };
  } catch (err) {
    log.error("flashcard-generator-failed", { topicId: request.topicId, error: (err as Error).message });
    throw new Error(`Failed to generate flashcards: ${(err as Error).message}`);
  }
}

function parseFlashcardsResponse(
  content: string,
  language: Language,
  difficulty: Difficulty
): FlashcardData[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found in response");
    const parsed = JSON.parse(jsonMatch[0]);

    return parsed.map((fc: Record<string, unknown>) => {
      const tags = Array.isArray(fc.tags)
        ? fc.tags.filter((tag: unknown): tag is string => typeof tag === "string" && tag.trim().length > 0)
        : [];

      return {
        id: crypto.randomUUID(),
        userId: "",
        subjectId: undefined,
        topicId: undefined,
        front: (fc.front as string) ?? "",
        back: (fc.back as string) ?? "",
        difficulty: ((fc.difficulty as Difficulty | undefined) ?? difficulty) as Difficulty,
        tags,
        language: (fc.language as Language | undefined) ?? language,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
  } catch (err) {
    log.error("flashcard-parse-failed", { error: (err as Error).message });
    throw new Error(`Failed to parse generated flashcards: ${(err as Error).message}`);
  }
}

export async function scheduleFlashcardReview(
  flashcardId: string,
  userId: string,
  rating: 1 | 2 | 3 | 4
): Promise<{
  nextReviewAt: Date;
  interval: number;
  easeFactor: number;
  repetitions: number;
}> {
  // SM-2 Algorithm (SuperMemo 2) for spaced repetition
  const review = await prisma.flashcardReview.findFirst({
    where: { flashcardId, userId },
    orderBy: { reviewedAt: "desc" },
  });

  let interval = 1;
  let easeFactor = 2.5;
  let repetitions = 0;

  if (review) {
    interval = review.interval;
    easeFactor = review.easeFactor;
    repetitions = review.repetitions;
  }

  // SM-2 algorithm
  if (rating >= 3) {
    // Correct response
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);

    repetitions += 1;
  } else {
    // Incorrect response - reset
    interval = 1;
    repetitions = 0;
  }

  // Update ease factor
  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02)));

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  await prisma.flashcardReview.create({
    data: {
      flashcardId,
      userId,
      rating,
      interval,
      easeFactor,
      repetitions,
      nextReviewAt,
      reviewedAt: new Date(),
    },
  });

  // Update flashcard next review
  return { nextReviewAt, interval, easeFactor, repetitions };
}

export async function getDueFlashcards(userId: string, limit = 50): Promise<{
  due: FlashcardData[];
  total: number;
}> {
  const now = new Date();

  const reviews = await prisma.flashcardReview.findMany({
    where: {
      userId,
      nextReviewAt: { lte: now },
    },
    take: limit,
    orderBy: { nextReviewAt: "asc" },
    include: { flashcard: true },
  });

  const flashcards: FlashcardData[] = reviews.map((r) => ({
    id: r.flashcard.id,
    userId: r.flashcard.userId,
    subjectId: r.flashcard.subjectId ?? undefined,
    topicId: r.flashcard.topicId ?? undefined,
    front: r.flashcard.front,
    back: r.flashcard.back,
    difficulty: r.flashcard.difficulty as Difficulty,
    tags: r.flashcard.tags ? r.flashcard.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
    language: r.flashcard.language as Language,
    createdAt: r.flashcard.createdAt,
    updatedAt: r.flashcard.updatedAt,
  }));

  const total = await prisma.flashcardReview.count({
    where: { userId, nextReviewAt: { lte: now } },
  });

  return { due: flashcards, total };
}
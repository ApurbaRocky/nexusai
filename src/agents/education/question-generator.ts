/**
 * Question Generator (Phase 4 - Education Agent)
 * Generates educational questions of various types with validation.
 */
import { getProvider } from "@/ai/providers/registry";
import { resolveKeySource } from "@/security/api-key-resolver";
import { lookupModel } from "@/ai/model-catalog";
import { retrieveContext } from "@/rag/service";
import type {
  EducationQuestionGenerateRequest,
  EducationQuestionGenerateResponse,
  QuestionData,
  QuestionType,
  Difficulty,
  Language,
} from "@/agents/education/education-types";
import { log } from "@/utils/log";

const MODEL_ID = "openai:gpt-4o-mini";

const TYPE_PROMPTS: Record<QuestionType, string> = {
  mcq: `Generate MULTIPLE CHOICE QUESTIONS (MCQs).
Each question must have:
- A clear, unambiguous question stem
- Exactly 4 options (A, B, C, D)
- Exactly ONE correct answer
- A brief explanation of why the correct answer is right and others are wrong
- Difficulty appropriate to the level`,

  true_false: `Generate TRUE/FALSE QUESTIONS.
Each question must have:
- A clear statement that is definitively true or false
- The correct answer (True/False)
- A brief explanation`,

  fill_blank: `Generate FILL-IN-THE-BLANK QUESTIONS.
Each question must have:
- A sentence with a key term removed (marked with _____)
- The correct answer
- A brief explanation`,

  short: `Generate SHORT ANSWER QUESTIONS (2-5 marks).
Each question must have:
- A focused question requiring a concise answer
- A model answer with key points
- Suggested marking scheme`,

  long: `Generate LONG ANSWER QUESTIONS (10+ marks).
Each question must have:
- A comprehensive question requiring detailed explanation
- A structured model answer with introduction, body, conclusion
- Detailed marking points`,

  viva: `Generate VIVA/ORAL EXAM QUESTIONS.
Each question must have:
- A question suitable for oral examination
- Expected key points in the answer
- Possible follow-up questions`,

  matching: `Generate MATCHING QUESTIONS.
Each question must have:
- Two columns with items to match
- Clear one-to-one or one-to-many mapping
- Correct matches with explanations`,

  case_based: `Generate CASE-BASED QUESTIONS.
Each question must have:
- A realistic scenario/case description
- Questions based on the case
- Model answers with reasoning`,
};

const LANGUAGE_INSTRUCTIONS: Record<Language, string> = {
  en: "Generate questions in ENGLISH.",
  bn: "প্রশ্নগুলি বাংলা (Bengali) ভাষায় তৈরি করুন। শুদ্ধ বাংলা ব্যাকরণ এবং শব্দ ব্যবহার করুন।",
  mixed: "Generate questions in MIXED Bengali-English. Use Bengali for explanations, English for technical terms.",
};

export async function generateQuestions(
  request: EducationQuestionGenerateRequest,
  userId: string
): Promise<EducationQuestionGenerateResponse> {
  const key = await resolveKeySource(userId, "openai");
  const model = lookupModel(MODEL_ID);
  const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

  if (!provider || !model) {
    throw new Error("Question generator requires an OpenAI-compatible provider");
  }

  let context = "";
  if (request.documentIds && request.documentIds.length > 0) {
    const ragResult = await retrieveContext(request.topic, {
      documentIds: request.documentIds,
      topK: 8,
    });

    if (ragResult.length > 0) {
      context = ragResult
        .map((c, i) => `[${i + 1}] Source: "${c.filename}"${c.page ? ` (page ${c.page})` : ""}\n${c.content}`)
        .join("\n\n---\n\n");
    }
  }

  const typePrompt = TYPE_PROMPTS[request.type];
  const languageInstruction = LANGUAGE_INSTRUCTIONS[request.language ?? "en"];

  const marksInstruction = request.examMarks
    ? `\n\nEXAM MARKS FORMAT: This is a ${request.examMarks}-MARK question. Structure the answer accordingly:
- 1-2 marks: Definition + 1-2 key points
- 3-5 marks: Definition, key points, brief explanation, example
- 10+ marks: Introduction, definition, detailed explanation, classification/features, examples, diagram description, conclusion`
    : "";

  const systemPrompt = `You are an expert question setter for educational assessments.
${typePrompt}
${languageInstruction}
${marksInstruction}

${context ? `Use ONLY the following source material. Cite sources using [1], [2] format:\n\n${context}\n\nBase questions STRICTLY on this material.` : "Generate questions from general knowledge. Clearly label if not from provided sources."}

OUTPUT FORMAT: Return a JSON array of questions. Each question object must have:
- question: string
- type: "${request.type}"
- difficulty: "${request.difficulty}"
- options?: [{"label": "A", "text": "..."}, ...] (for MCQ)
- correctAnswer: string
- explanation: string
- topic: string
- sourceDocId?: string
- sourcePage?: number
- language: "${request.language ?? "en"}"

Generate EXACTLY ${request.count} questions.`;

  try {
    const result = await provider.complete({
      model,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Topic: ${request.topic}` }],
      temperature: 0.5,
      maxTokens: 4000,
    });

    const questions = parseQuestionsResponse(result.content, request.type, request.difficulty, request.language ?? "en");

    if (questions.length !== request.count) {
      log.warn("question-count-mismatch", { requested: request.count, generated: questions.length });
    }

    const validatedQuestions = await validateQuestions(questions, request.type);

    return { questions: validatedQuestions };
  } catch (err) {
    log.error("question-generator-failed", { topic: request.topic, error: (err as Error).message });
    throw new Error(`Failed to generate questions: ${(err as Error).message}`);
  }
}

function parseQuestionsResponse(
  content: string,
  type: QuestionType,
  difficulty: Difficulty,
  language: Language
): QuestionData[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found in response");
    const parsed = JSON.parse(jsonMatch[0]);

    return parsed.map((q: Record<string, unknown>) => {
      const options = Array.isArray(q.options) ? q.options as Record<string, unknown>[] : undefined;

      return {
        id: crypto.randomUUID(),
        userId: "", // Will be set by caller
        subjectId: undefined,
        topicId: undefined,
        question: (q.question as string) ?? "",
        type: (q.type as QuestionType) ?? type,
        difficulty: (q.difficulty as Difficulty) ?? difficulty,
        options: options?.map((o) => ({ label: (o.label as string) ?? "", text: (o.text as string) ?? "" })),
        correctAnswer: (q.correctAnswer as string) ?? "",
        explanation: (q.explanation as string) ?? "",
        source: q.sourceDocId ? "document" : "general",
        sourceDocId: q.sourceDocId as string | undefined,
        sourcePage: q.sourcePage as number | undefined,
        tags: q.tags as string[] | undefined,
        language: (q.language as Language) ?? language,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
  } catch (err) {
    log.error("question-parse-failed", { error: (err as Error).message, content: content.slice(0, 500) });
    throw new Error(`Failed to parse generated questions: ${(err as Error).message}`);
  }
}

async function validateQuestions(questions: QuestionData[], type: QuestionType): Promise<QuestionData[]> {
  const validated: QuestionData[] = [];

  for (const q of questions) {
    if (type === "mcq") {
      if (!q.options || q.options.length !== 4) {
        log.warn("mcq-invalid-options", { question: q.question, optionsCount: q.options?.length });
        continue;
      }
      const correctCount = q.options.filter((o) => o.label === q.correctAnswer).length;
      if (correctCount !== 1) {
        log.warn("mcq-invalid-correct", { question: q.question, correctCount });
        continue;
      }
      // Check for duplicate options
      const texts = q.options.map((o) => o.text.trim().toLowerCase());
      if (new Set(texts).size !== texts.length) {
        log.warn("mcq-duplicate-options", { question: q.question });
        continue;
      }
    }
    validated.push(q);
  }

  return validated;
}
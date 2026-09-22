/**
 * Answer Evaluator (Phase 4 - Education Agent)
 * Evaluates student answers with detailed feedback.
 */
import { getProvider } from "@/ai/providers/registry";
import { resolveKeySource } from "@/security/api-key-resolver";
import { lookupModel } from "@/ai/model-catalog";
import type {
  EducationEvaluateRequest,
  EducationEvaluateResponse,
  Language,
} from "@/agents/education/education-types";
import { log } from "@/utils/log";

const MODEL_ID = "openai:gpt-4o-mini";

const SYSTEM_PROMPT = `You are an expert educator evaluating student answers.
Your role is to provide CONSTRUCTIVE, DETAILED feedback that helps learning.

EVALUATION CRITERIA:
1. ACCURACY - Is the answer factually correct?
2. COMPLETENESS - Does it cover all required points?
3. STRUCTURE - Is it well-organized with clear logic?
4. KEY CONCEPTS - Are the essential concepts included?
5. TERMINOLOGY - Is appropriate technical language used?
6. EXAMPLES - Are relevant examples provided where appropriate?

OUTPUT FORMAT (JSON):
{
  "score": number (0 to maxScore),
  "maxScore": number,
  "feedback": {
    "strengths": ["strength1", "strength2", ...],
    "weaknesses": ["weakness1", "weakness2", ...],
    "missingPoints": ["missing1", "missing2", ...],
    "improvements": ["improvement1", "improvement2", ...]
  },
  "idealAnswer": "A well-structured model answer",
  "keyPoints": ["point1", "point2", ...]
}

Be encouraging but honest. Distinguish between minor gaps and fundamental misunderstandings.`;

const LANGUAGE_PROMPTS: Record<Language, string> = {
  en: "Evaluate in ENGLISH.",
  bn: "বাংলা (Bengali) ভাষায় মূল্যায়ন করুন। প্রতিক্রিয়া বাংলায় দিন।",
  mixed: "Evaluate in MIXED Bengali-English. Use Bengali for explanations, English for technical terms.",
};

export async function evaluateAnswer(
  request: EducationEvaluateRequest,
  userId: string
): Promise<EducationEvaluateResponse> {
  const language = request.language ?? "en";
  const maxScore = request.totalMarks ?? 10;

  const key = await resolveKeySource(userId, "openai");
  const model = lookupModel(MODEL_ID);
  const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

  if (!provider || !model) {
    throw new Error("Answer evaluator requires an OpenAI-compatible provider");
  }

  const markingSchemeInstruction = request.markingScheme
    ? `\n\nMARKING SCHEME:\n${request.markingScheme}\nFollow this strictly for scoring.`
    : "";

  const expectedAnswerContext = request.expectedAnswer
    ? `\n\nEXPECTED ANSWER (for reference):\n${request.expectedAnswer}\nUse this as a guide but evaluate the student's answer on its own merits.`
    : "";

  const systemPrompt = `${SYSTEM_PROMPT}\n${LANGUAGE_PROMPTS[language]}${markingSchemeInstruction}${expectedAnswerContext}\n\nTotal marks available: ${maxScore}`;

  const userPrompt = `QUESTION:\n${request.question}\n\nSTUDENT'S ANSWER:\n${request.userAnswer}\n\nPlease evaluate and provide detailed feedback with a score out of ${maxScore}.`;

  try {
    const result = await provider.complete({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 1500,
    });

    const parsed = parseEvaluationResponse(result.content, maxScore);
    return parsed;
  } catch (err) {
    log.error("answer-evaluator-failed", { question: request.question.slice(0, 100), error: (err as Error).message });
    throw new Error(`Failed to evaluate answer: ${(err as Error).message}`);
  }
}

function parseEvaluationResponse(content: string, maxScore: number): EducationEvaluateResponse {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found in response");
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      score: Math.min(Math.max(0, parsed.score ?? 0), maxScore),
      maxScore: parsed.maxScore ?? maxScore,
      feedback: {
        strengths: Array.isArray(parsed.feedback?.strengths) ? parsed.feedback.strengths : [],
        weaknesses: Array.isArray(parsed.feedback?.weaknesses) ? parsed.feedback.weaknesses : [],
        missingPoints: Array.isArray(parsed.feedback?.missingPoints) ? parsed.feedback.missingPoints : [],
        improvements: Array.isArray(parsed.feedback?.improvements) ? parsed.feedback.improvements : [],
      },
      idealAnswer: parsed.idealAnswer ?? "",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    };
  } catch (err) {
    log.error("evaluation-parse-failed", { error: (err as Error).message });
    return {
      score: 0,
      maxScore,
      feedback: {
        strengths: [],
        weaknesses: ["Unable to parse evaluation"],
        missingPoints: [],
        improvements: ["Please try again"],
      },
      idealAnswer: "Evaluation failed - please try again",
      keyPoints: [],
    };
  }
}

export async function evaluateVivaAnswer(
  question: string,
  userAnswer: string,
  userId: string,
  language: Language = "en"
): Promise<EducationEvaluateResponse> {
  return evaluateAnswer({
    question,
    userAnswer,
    totalMarks: 5,
    language,
  }, userId);
}
/**
 * Explanation Engine (Phase 4 - Education Agent)
 * Generates educational explanations at different levels with citations.
 */
import { getProvider } from "@/ai/providers/registry";
import { resolveKeySource } from "@/security/api-key-resolver";
import { lookupModel } from "@/ai/model-catalog";
import { retrieveContext } from "@/rag/service";
import { log } from "@/utils/log";
import type {
  EducationExplainRequest,
  EducationExplainResponse,
  EducationCitation,
  ExplanationLevel,
} from "@/agents/education/education-types";

const MODEL_ID = "openai:gpt-4o-mini";

const SYSTEM_PROMPTS: Record<ExplanationLevel, string> = {
  beginner: `You are an expert educator explaining concepts to a BEGINNER student.
- Use simple language, avoid jargon
- Use analogies and real-world examples
- Break complex ideas into small steps
- Check understanding with simple questions
- Keep explanations encouraging and clear`,

  intermediate: `You are an expert educator explaining concepts to an INTERMEDIATE student.
- Use appropriate technical terminology
- Provide structured explanations with clear reasoning
- Include relevant examples and applications
- Connect concepts to broader context
- Assume some prior knowledge`,

  advanced: `You are an expert educator explaining concepts to an ADVANCED student.
- Use precise technical language and formal definitions
- Cover nuance, edge cases, and current research
- Discuss theoretical foundations and mathematical models where relevant
- Reference key papers or established theories
- Assume strong foundational knowledge`,
};

const MODE_PROMPTS: Record<string, string> = {
  simple: "Provide a SIMPLE, easy-to-understand explanation. Focus on the core idea with minimal jargon.",
  deep: "Provide a DEEP, comprehensive explanation. Cover mechanisms, underlying principles, and connections.",
  example: "Focus on PRACTICAL EXAMPLES. Show how the concept applies in real situations.",
  exam: "Provide an EXAM-READY answer. Structure with definition, key points, explanation, and conclusion suitable for written exams.",
  notes: "Create concise STUDY NOTES. Use bullet points, key terms, and summary format for revision.",
};

export async function generateExplanation(
  request: EducationExplainRequest,
  userId: string
): Promise<EducationExplainResponse> {
  const level = request.level ?? "intermediate";
  const language = request.language ?? "en";
  const mode = request.mode ?? "deep";

  const key = await resolveKeySource(userId, "openai");
  const model = lookupModel(MODEL_ID);
  const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

  if (!provider || !model) {
    throw new Error("Education agent requires an OpenAI-compatible provider");
  }

  let context = "";
  let citations: EducationCitation[] = [];

  if (request.documentIds && request.documentIds.length > 0) {
    const ragResult = await retrieveContext(request.topic, {
      documentIds: request.documentIds,
      topK: 5,
    });

    if (ragResult.length > 0) {
      context = ragResult
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

  const systemPrompt = `${SYSTEM_PROMPTS[level]}\n\n${MODE_PROMPTS[mode]}\n\nLanguage: ${language === "bn" ? "Bengali (বাংলা)" : language === "mixed" ? "Mixed Bengali-English" : "English"}\n\n${
    context
      ? `Use ONLY the following sources for factual claims. Cite using [1], [2] format:\n\n${context}\n\nIf the sources don't contain enough information, say so and provide general knowledge clearly labelled as such.`
      : "Provide a clear, well-structured explanation. If you don't have specific sources, state that this is general knowledge."
  }`;

  const userPrompt = `Topic: ${request.topic}\n\nPlease provide a ${mode} explanation at ${level} level in ${language === "bn" ? "Bengali" : language === "mixed" ? "mixed Bengali-English" : "English"}.`;

  try {
    const result = await provider.complete({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      maxTokens: 2000,
    });

    const content = result.content.trim();

    const keyPoints = extractKeyPoints(content);
    const examples = extractExamples(content);
    const examAnswer = mode === "exam" ? extractExamAnswer(content) : undefined;
    const followUpQuestions = generateFollowUpQuestions(request.topic, level);

    return {
      topic: request.topic,
      level,
      language,
      explanation: content,
      keyPoints,
      examples,
      examAnswer,
      citations,
      followUpQuestions,
    };
  } catch (err) {
    log.error("explanation-engine-failed", { topic: request.topic, error: (err as Error).message });
    throw new Error(`Failed to generate explanation: ${(err as Error).message}`);
  }
}

function extractKeyPoints(content: string): string[] {
  const points: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^[-*•]\s+/) || trimmed.match(/^\d+\.\s+/)) {
      points.push(trimmed.replace(/^[-*•\d.]\s+/, ""));
    }
  }
  return points.slice(0, 10);
}

function extractExamples(content: string): string[] {
  const examples: string[] = [];
  const exampleRegex = /(?:example|for instance|e\.g\.|such as)[:\s]([^.]+)/gi;
  let match;
  while ((match = exampleRegex.exec(content)) !== null) {
    examples.push(match[1].trim());
  }
  return examples.slice(0, 5);
}

function extractExamAnswer(content: string): string {
  return content;
}

function generateFollowUpQuestions(topic: string, level: ExplanationLevel): string[] {
  const baseQuestions = [
    `What are the key applications of ${topic}?`,
    `How does ${topic} relate to other concepts in this field?`,
    `What are common misconceptions about ${topic}?`,
  ];

  if (level === "beginner") {
    return [
      ...baseQuestions,
      `Can you give a simple real-world example of ${topic}?`,
      `What are the most important terms to remember for ${topic}?`,
    ];
  } else if (level === "advanced") {
    return [
      ...baseQuestions,
      `What are the current research frontiers in ${topic}?`,
      `What are the mathematical foundations underlying ${topic}?`,
      `How has understanding of ${topic} evolved over time?`,
    ];
  }

  return baseQuestions;
}
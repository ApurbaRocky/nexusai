/**
 * Quiz Engine (Phase 4 - Education Agent)
 * Manages interactive quiz sessions with adaptive difficulty.
 */
import { prisma } from "@/database/client";
import type {
  QuizSessionData,
  QuizSettings,
  QuizQuestionData,
  QuestionData,
  QuestionType,
  Language,
} from "@/agents/education/education-types";

function normalizeQuestionData(question: Record<string, unknown>): QuestionData {
  const options = question.options ? JSON.parse(question.options as string) : undefined;

  return {
    id: question.id as string,
    userId: question.userId as string,
    subjectId: question.subjectId as string | undefined,
    topicId: question.topicId as string | undefined,
    question: question.question as string,
    type: question.type as QuestionType,
    difficulty: question.difficulty as QuestionData["difficulty"],
    options: Array.isArray(options) ? options : undefined,
    correctAnswer: question.correctAnswer as string | undefined,
    explanation: question.explanation as string | undefined,
    source: question.source as string | undefined,
    sourceDocId: question.sourceDocId as string | undefined,
    sourcePage: question.sourcePage as number | undefined,
    tags: question.tags ? (question.tags as string).split(",").map((tag: string) => tag.trim()).filter(Boolean) : undefined,
    language: (question.language as Language) ?? "en",
    createdAt: question.createdAt as Date,
    updatedAt: question.updatedAt as Date,
  };
}

export async function startQuiz(
  userId: string,
  subjectId: string | undefined,
  topicId: string | undefined,
  name: string,
  questionCount: number,
  settings: QuizSettings = {}
): Promise<{ sessionId: string; firstQuestion: QuizQuestionData }> {
  const questions = await selectQuizQuestions(userId, subjectId, topicId, questionCount, settings);

  if (questions.length === 0) {
    throw new Error("No questions available for the selected criteria");
  }

  const sessionSettings = { ...settings, questionIds: questions.map((q) => q.id) };

  const session = await prisma.quizSession.create({
    data: {
      userId,
      subjectId,
      topicId,
      name,
      totalQuestions: questions.length,
      currentIndex: 0,
      score: 0,
      status: "in_progress",
      settings: JSON.stringify(sessionSettings),
    },
  });

  const firstQuestion = formatQuizQuestion(questions[0], 0, questions.length, settings.timeLimit);

  return { sessionId: session.id, firstQuestion };
}

export async function answerQuizQuestion(
  sessionId: string,
  userId: string,
  questionId: string,
  answer: string,
  timeSpent?: number
): Promise<{
  isCorrect: boolean;
  correctAnswer?: string;
  explanation?: string;
  score: number;
  nextQuestion?: QuizQuestionData;
  completed: boolean;
  finalScore?: number;
}> {
  const session = await prisma.quizSession.findFirst({
    where: { id: sessionId, userId },
    include: { answers: true },
  });

  if (!session) throw new Error("Quiz session not found");
  if (session.status !== "in_progress") throw new Error("Quiz already completed");

  const sessionSettings = session.settings ? JSON.parse(session.settings) : { questionIds: [] };
  const questionIds: string[] = Array.isArray(sessionSettings.questionIds) ? sessionSettings.questionIds : [];

  if (!questionIds.includes(questionId)) {
    throw new Error("Question not part of this quiz");
  }

  const currentIndex = session.currentIndex;
  if (currentIndex >= questionIds.length) {
    throw new Error("Quiz already completed");
  }

  const question = await prisma.question.findUnique({ where: { id: questionId } });
  if (!question) throw new Error("Question not found");

  const questionData = normalizeQuestionData(question);
  const isCorrect = evaluateAnswer(questionData, answer);
  const newScore = session.score + (isCorrect ? 1 : 0);

  await prisma.quizAnswer.create({
    data: {
      quizSessionId: session.id,
      questionId,
      userAnswer: answer,
      isCorrect,
      timeSpent,
    },
  });

  const nextIndex = currentIndex + 1;
  const isCompleted = nextIndex >= questionIds.length;

  await prisma.quizSession.update({
    where: { id: sessionId },
    data: {
      currentIndex: nextIndex,
      score: newScore,
      status: isCompleted ? "completed" : "in_progress",
      completedAt: isCompleted ? new Date() : null,
    },
  });

  let nextQuestion: QuizQuestionData | undefined;
  if (!isCompleted) {
    const nextQuestionId = questionIds[nextIndex];
    const nextQ = await prisma.question.findUnique({ where: { id: nextQuestionId } });
    if (nextQ) {
      const settings = session.settings ? JSON.parse(session.settings) : {};
      const nextQuestionData = normalizeQuestionData(nextQ);
      nextQuestion = formatQuizQuestion(nextQuestionData, nextIndex, questionIds.length, settings.timeLimit);
    }
  }

  return {
    isCorrect,
    correctAnswer: isCorrect ? undefined : questionData.correctAnswer ?? undefined,
    explanation: questionData.explanation ?? undefined,
    score: newScore,
    nextQuestion,
    completed: isCompleted,
    finalScore: isCompleted ? newScore : undefined,
  };
}

export async function getQuizProgress(sessionId: string, userId: string): Promise<{
  session: QuizSessionData;
  currentQuestion?: QuizQuestionData;
  progress: number;
}> {
  const session = await prisma.quizSession.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) throw new Error("Quiz session not found");

  const sessionSettings = session.settings ? JSON.parse(session.settings) : { questionIds: [] };
  const questionIds: string[] = Array.isArray(sessionSettings.questionIds) ? sessionSettings.questionIds : [];

  let currentQuestion: QuizQuestionData | undefined;
  if (session.currentIndex < questionIds.length) {
    const question = await prisma.question.findUnique({ where: { id: questionIds[session.currentIndex] } });
    if (question) {
      const settings = session.settings ? JSON.parse(session.settings) : {};
      currentQuestion = formatQuizQuestion(normalizeQuestionData(question), session.currentIndex, questionIds.length, settings.timeLimit);
    }
  }

  return {
    session: {
      id: session.id,
      userId: session.userId,
      subjectId: session.subjectId ?? undefined,
      topicId: session.topicId ?? undefined,
      name: session.name,
      totalQuestions: session.totalQuestions,
      currentIndex: session.currentIndex,
      score: session.score,
      status: session.status as QuizSessionData["status"],
      settings: session.settings ? JSON.parse(session.settings) : undefined,
      startedAt: session.startedAt,
      completedAt: session.completedAt ?? undefined,
    },
    currentQuestion,
    progress: (session.currentIndex / session.totalQuestions) * 100,
  };
}

async function selectQuizQuestions(
  userId: string,
  subjectId: string | undefined,
  topicId: string | undefined,
  count: number,
  settings: QuizSettings
): Promise<QuestionData[]> {
  const where: Record<string, unknown> = { userId };

  if (subjectId) where.subjectId = subjectId;
  if (topicId) where.topicId = topicId;
  if (settings.difficulty) where.difficulty = settings.difficulty;
  if (settings.questionTypes && settings.questionTypes.length > 0) {
    where.type = { in: settings.questionTypes };
  }

  const questions = await prisma.question.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: count * 3,
  });

  if (questions.length === 0) return [];

  let filtered = questions.map((question) => normalizeQuestionData(question));

  if (settings.shuffleQuestions) {
    filtered = shuffleArray([...filtered]);
  }

  return filtered.slice(0, count);
}

function evaluateAnswer(question: QuestionData, userAnswer: string): boolean {
  const correct = question.correctAnswer?.trim().toLowerCase();
  const user = userAnswer.trim().toLowerCase();

  if (!correct) return false;

  if (question.type === "mcq" && question.options) {
    const correctOption = question.options.find((o) => o.label === correct);
    if (correctOption) {
      return user === correct.toLowerCase() || user === correctOption.text.trim().toLowerCase();
    }
  }

  if (question.type === "true_false") {
    return user === correct;
  }

  return user === correct || user.includes(correct) || correct.includes(user);
}

function formatQuizQuestion(
  question: QuestionData,
  index: number,
  total: number,
  timeLimit?: number
): QuizQuestionData {
  return {
    questionId: question.id,
    index,
    total,
    question: question.question,
    type: question.type,
    options: question.options,
    difficulty: question.difficulty,
    timeRemaining: timeLimit,
  };
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
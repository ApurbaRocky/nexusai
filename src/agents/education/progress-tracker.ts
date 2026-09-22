/**
 * Progress Tracker (Phase 4 - Education Agent)
 * Tracks learning progress, detects weak topics, and provides analytics.
 */
import { prisma } from "@/database/client";
import type {
  StudyProgressData,
  WeakTopic,
  StudyActivityLog,
  EducationProgressResponse,
} from "@/agents/education/education-types";

export async function getUserProgress(userId: string): Promise<EducationProgressResponse> {
  const overallProgress = await getOverallProgress(userId);
  const bySubject = await getProgressBySubject(userId);
  const byTopic = await getProgressByTopic(userId);
  const weakTopics = await detectWeakTopicsInternal(userId);
  const recentActivity = await getRecentActivityInternal(userId, 20);

  return {
    overall: overallProgress,
    bySubject,
    byTopic,
    weakTopics,
    recentActivity,
  };
}

async function getOverallProgress(userId: string): Promise<StudyProgressData> {
  const progress = await prisma.studyProgress.findFirst({
    where: { userId, subjectId: null, topicId: null },
  });

  if (!progress) {
    const quizAnswers = await prisma.quizAnswer.findMany({
      where: { quizSession: { userId } },
      select: { isCorrect: true },
    });

    const studyMinutes = await calculateTotalStudyMinutes(userId);

    const totalAttempted = quizAnswers.length;
    const totalCorrect = quizAnswers.filter(a => a.isCorrect).length;

    return {
      id: "overall",
      userId,
      questionsAttempted: totalAttempted,
      questionsCorrect: totalCorrect,
      accuracy: totalAttempted > 0 ? totalCorrect / totalAttempted : 0,
      studyMinutes,
      flashcardsReviewed: totalAttempted > 0 ? 0 : 0,
      masteryEstimate: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return {
    id: progress.id,
    userId: progress.userId,
    subjectId: progress.subjectId ?? undefined,
    topicId: progress.topicId ?? undefined,
    questionsAttempted: progress.questionsAttempted,
    questionsCorrect: progress.questionsCorrect,
    accuracy: progress.accuracy,
    studyMinutes: progress.studyMinutes,
    flashcardsReviewed: progress.flashcardsReviewed,
    masteryEstimate: progress.masteryEstimate,
    lastStudiedAt: progress.lastStudiedAt ?? undefined,
    createdAt: progress.createdAt,
    updatedAt: progress.updatedAt,
  };
}

async function getProgressBySubject(userId: string): Promise<StudyProgressData[]> {
  const subjects = await prisma.subject.findMany({
    where: { userId },
    include: { topics: true },
  });

  const progress: StudyProgressData[] = [];

  for (const subject of subjects) {
    const progressData = await prisma.studyProgress.findFirst({
      where: { userId, subjectId: subject.id, topicId: null },
    });

    if (progressData) {
      progress.push({
        id: progressData.id,
        userId: progressData.userId,
        subjectId: progressData.subjectId ?? undefined,
        topicId: progressData.topicId ?? undefined,
        questionsAttempted: progressData.questionsAttempted,
        questionsCorrect: progressData.questionsCorrect,
        accuracy: progressData.accuracy,
        studyMinutes: progressData.studyMinutes,
        flashcardsReviewed: progressData.flashcardsReviewed,
        masteryEstimate: progressData.masteryEstimate,
        lastStudiedAt: progressData.lastStudiedAt ?? undefined,
        createdAt: progressData.createdAt,
        updatedAt: progressData.updatedAt,
      });
    } else {
      const quizAnswers = await prisma.quizAnswer.findMany({
        where: { quizSession: { userId, subjectId: subject.id } },
        select: { isCorrect: true },
      });

      const studyMinutes: number = await calculateSubjectStudyMinutes(userId, subject.id);

      const totalAttempted = quizAnswers.length;
      const totalCorrect = quizAnswers.filter(a => a.isCorrect).length;

      progress.push({
        id: `subject-${subject.id}`,
        userId,
        subjectId: subject.id,
        questionsAttempted: quizAnswers.length,
        questionsCorrect: totalCorrect,
        accuracy: quizAnswers.length > 0 ? totalCorrect / quizAnswers.length : 0,
        studyMinutes,
        flashcardsReviewed: totalAttempted > 0 ? 0 : 0,
        masteryEstimate: calculateMasteryEstimate(quizAnswers.length, totalCorrect, 0),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  return progress;
}

async function getProgressByTopic(userId: string): Promise<StudyProgressData[]> {
  const topics = await prisma.topic.findMany({
    where: { subject: { userId } },
    include: { subject: true },
  });

  const progress: StudyProgressData[] = [];

  for (const topic of topics) {
    const progressData = await prisma.studyProgress.findFirst({
      where: { userId, topicId: topic.id },
    });

    if (progressData) {
      progress.push({
        id: progressData.id,
        userId: progressData.userId,
        subjectId: progressData.subjectId ?? undefined,
        topicId: progressData.topicId ?? undefined,
        questionsAttempted: progressData.questionsAttempted,
        questionsCorrect: progressData.questionsCorrect,
        accuracy: progressData.accuracy,
        studyMinutes: progressData.studyMinutes,
        flashcardsReviewed: progressData.flashcardsReviewed,
        masteryEstimate: progressData.masteryEstimate,
        lastStudiedAt: progressData.lastStudiedAt ?? undefined,
        createdAt: progressData.createdAt,
        updatedAt: progressData.updatedAt,
      });
    }
  }

  return progress;
}

async function detectWeakTopicsInternal(userId: string): Promise<WeakTopic[]> {
  const topics = await prisma.topic.findMany({
    where: { subject: { userId } },
    include: { subject: true },
  });

  const weakTopics: WeakTopic[] = [];

  for (const topic of topics) {
    const quizAnswers = await prisma.quizAnswer.findMany({
      where: { quizSession: { userId, topicId: topic.id } },
      include: { question: true },
    });

    if (quizAnswers.length < 5) continue;

    const total = quizAnswers.length;
    const correct = quizAnswers.filter((a) => a.isCorrect).length;
    const accuracy = correct / total;

    const flashcards = await prisma.flashcard.findMany({
      where: { userId, topicId: topic.id },
      include: { reviews: true },
    });

    let flashcardAccuracy = 1;
    if (flashcards.length > 0) {
      const totalReviews = flashcards.reduce((sum, fc) => sum + fc.reviews.length, 0);
      const goodReviews = flashcards.reduce(
        (sum, fc) => sum + fc.reviews.filter((r) => r.rating >= 3).length,
        0
      );
      flashcardAccuracy = totalReviews > 0 ? goodReviews / totalReviews : 1;
    }

    const combinedAccuracy = (accuracy * 0.7) + (flashcardAccuracy * 0.3);

    if (combinedAccuracy < 0.6 && total >= 5) {
      weakTopics.push({
        topicId: topic.id,
        topicName: topic.name,
        subjectName: topic.subject.name,
        accuracy: combinedAccuracy,
        questionsAttempted: total,
        recommendedActions: generateRecommendations(topic.name, accuracy, flashcardAccuracy),
      });
    }
  }

  return weakTopics.sort((a, b) => a.accuracy - b.accuracy).slice(0, 10);
}

function generateRecommendations(topicName: string, quizAccuracy: number, flashcardAccuracy: number): string[] {
  const actions: string[] = [];

  if (quizAccuracy < 0.5) {
    actions.push(`Review notes on ${topicName}`);
    actions.push(`Read explanation for ${topicName}`);
    actions.push(`Do 10 easy MCQs on ${topicName}`);
    actions.push(`Do 10 medium MCQs on ${topicName}`);
  } else if (quizAccuracy < 0.7) {
    actions.push(`Review weak areas in ${topicName}`);
    actions.push(`Do 10 medium MCQs on ${topicName}`);
    actions.push(`Practice viva questions on ${topicName}`);
  }

  if (flashcardAccuracy < 0.6) {
    actions.push(`Review flashcards for ${topicName}`);
    actions.push(`Create new flashcards for ${topicName}`);
  }

  if (actions.length === 0) {
    actions.push(`Continue regular practice on ${topicName}`);
  }

  return actions.slice(0, 5);
}

async function getRecentActivityInternal(userId: string, limit: number): Promise<StudyActivityLog[]> {
  const activities: StudyActivityLog[] = [];

  const quizSessions = await prisma.quizSession.findMany({
    where: { userId, status: "completed" },
    orderBy: { completedAt: "desc" },
    take: 10,
    include: { subject: true, topic: true },
  });

  for (const session of quizSessions) {
    if (session.completedAt) {
      activities.push({
        id: `quiz-${session.id}`,
        type: "quiz",
        subjectName: session.subject?.name,
        topicName: session.topic?.name,
        durationMinutes: Math.round(
          (session.completedAt!.getTime() - session.startedAt.getTime()) / 60000
        ),
        score: Math.round((session.score / session.totalQuestions) * 100),
        createdAt: session.completedAt!,
      });
    }
  }

  const flashcardReviews = await prisma.flashcardReview.findMany({
    where: { userId },
    orderBy: { reviewedAt: "desc" },
    take: 10,
    include: { flashcard: { include: { subject: true, topic: true } } },
  });

  for (const review of flashcardReviews) {
    activities.push({
      id: `flashcard-${review.id}`,
      type: "flashcard",
      subjectName: review.flashcard.subject?.name,
      topicName: review.flashcard.topic?.name,
      durationMinutes: 1,
      score: review.rating >= 3 ? 100 : 0,
      createdAt: review.reviewedAt,
    });
  }

  activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return activities.slice(0, limit);
}

async function calculateTotalStudyMinutes(userId: string): Promise<number> {
  const quizSessions = await prisma.quizSession.findMany({
    where: { userId, status: "completed" },
    select: { startedAt: true, completedAt: true },
  });

  let totalMinutes = 0;
  for (const session of quizSessions) {
    if (session.completedAt) {
      totalMinutes += Math.round(
        (session.completedAt!.getTime() - session.startedAt.getTime()) / 60000
      );
    }
  }

  const flashcardReviews = await prisma.flashcardReview.count({ where: { userId } });
  return totalMinutes + flashcardReviews;
}

async function calculateSubjectStudyMinutes(userId: string, subjectId: string): Promise<number> {
  const quizSessions = await prisma.quizSession.findMany({
    where: { userId, subjectId, status: "completed" },
    select: { startedAt: true, completedAt: true },
  });

  let totalMinutes = 0;
  for (const session of quizSessions) {
    if (session.completedAt) {
      totalMinutes += Math.round(
        (session.completedAt.getTime() - session.startedAt.getTime()) / 60000
      );
    }
  }

  const flashcardReviews = await prisma.flashcardReview.count({
    where: { userId, flashcard: { subjectId } },
  });
  return totalMinutes + flashcardReviews;
}

function calculateMasteryEstimate(attempted: number, correct: number, flashcardsReviewed: number = 0): number {
  if (attempted === 0 && flashcardsReviewed === 0) return 0;
  const quizScore = attempted > 0 ? correct / attempted : 0;
  const flashcardBonus = Math.min(flashcardsReviewed / 100, 0.2);
  return Math.min(quizScore + flashcardBonus, 1);
}

export async function updateProgressFromQuiz(
  userId: string,
  subjectId: string | undefined,
  topicId: string | undefined,
  isCorrect: boolean,
  timeSpent: number
): Promise<void> {
  const now = new Date();

  await prisma.studyProgress.upsert({
    where: { userId_subjectId_topicId: { userId, subjectId: subjectId ?? "", topicId: topicId ?? "" } },
    create: {
      userId,
      subjectId,
      topicId,
      questionsAttempted: 1,
      questionsCorrect: isCorrect ? 1 : 0,
      accuracy: isCorrect ? 1 : 0,
      studyMinutes: Math.round(timeSpent / 60000),
      lastStudiedAt: now,
    },
    update: {
      questionsAttempted: { increment: 1 },
      questionsCorrect: { increment: isCorrect ? 1 : 0 },
      studyMinutes: { increment: Math.round(timeSpent / 60000) },
      lastStudiedAt: now,
    },
  });

  const progress = await prisma.studyProgress.findFirst({
    where: { userId, subjectId, topicId },
  });

  if (progress && progress.questionsAttempted > 0) {
    await prisma.studyProgress.update({
      where: { id: progress.id },
      data: { accuracy: progress.questionsCorrect / progress.questionsAttempted },
    });
  }

  if (subjectId) {
    await prisma.studyProgress.upsert({
      where: { userId_subjectId_topicId: { userId, subjectId, topicId: "" } },
      create: {
        userId,
        subjectId,
        questionsAttempted: 1,
        questionsCorrect: isCorrect ? 1 : 0,
        accuracy: isCorrect ? 1 : 0,
        studyMinutes: Math.round(timeSpent / 60000),
        lastStudiedAt: now,
      },
      update: {
        questionsAttempted: { increment: 1 },
        questionsCorrect: { increment: isCorrect ? 1 : 0 },
        studyMinutes: { increment: Math.round(timeSpent / 60000) },
        lastStudiedAt: now,
      },
    });
  }
}

export async function detectWeakTopics(userId: string): Promise<WeakTopic[]> {
  return detectWeakTopicsInternal(userId);
}

export async function getRecentActivity(userId: string, limit: number): Promise<StudyActivityLog[]> {
  return getRecentActivityInternal(userId, limit);
}
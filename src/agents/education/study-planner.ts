/**
 * Study Planner (Phase 4 - Education Agent)
 * Generates personalized study plans based on exam dates, topics, and availability.
 */
import { getProvider } from "@/ai/providers/registry";
import { resolveKeySource } from "@/security/api-key-resolver";
import { lookupModel } from "@/ai/model-catalog";
import { prisma } from "@/database/client";
import type {
  EducationStudyPlanRequest,
  EducationStudyPlanResponse,
  StudyPlanData,
  StudyPlanDaily,
} from "@/agents/education/education-types";
import { log } from "@/utils/log";

const MODEL_ID = "openai:gpt-4o-mini";

const STUDY_PLAN_SYSTEM_PROMPT = `You are an expert academic planner creating personalized study schedules.

PLANNING PRINCIPLES:
1. SPACED REPETITION - Schedule reviews at increasing intervals
2. INTERLEAVING - Mix different topics in each session
3. ACTIVE RECALL - Prioritize practice questions over passive reading
4. PROGRESSIVE DIFFICULTY - Start with foundations, build to advanced
5. BUFFER TIME - Include margin for unexpected delays
6. REST - Schedule breaks and sleep

OUTPUT FORMAT: JSON with daily plans:
{
  "dailyPlans": [
    {
      "date": "2024-01-15",
      "topics": [
        {
          "topicId": "topic-id",
          "topicName": "Osmoregulation",
          "durationMinutes": 60,
          "activities": [
            { "type": "read", "topicId": "topic-id", "durationMinutes": 20 },
            { "type": "mcq", "count": 10, "durationMinutes": 20 },
            { "type": "summary", "topicId": "topic-id", "durationMinutes": 10 }
          ]
        }
      ],
      "totalMinutes": 90
    }
  ]
}

ACTIVITY TYPES:
- "read": Read/explain topic (passive learning)
- "mcq": Practice MCQs (active recall)
- "viva": Practice viva questions
- "flashcard": Flashcard review (spaced repetition)
- "summary": Create summary notes
- "practice": General practice/problems

BALANCE PRINCIPLES:
- 40% active recall (mcq, viva, flashcard, practice)
- 30% reading/explanation
- 20% summary/consolidation
- 10% review of previous material`;

export async function generateStudyPlan(
  request: EducationStudyPlanRequest,
  userId: string
): Promise<EducationStudyPlanResponse> {
  const key = await resolveKeySource(userId, "openai");
  const model = lookupModel(MODEL_ID);
  const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

  if (!provider || !model) {
    throw new Error("Study planner requires an OpenAI-compatible provider");
  }

  // Get subject and topics
  const subject = await prisma.subject.findFirst({
    where: { id: request.subjectId, userId },
    include: { topics: { where: { parentId: null }, orderBy: { order: "asc" } } },
  });

  if (!subject) throw new Error("Subject not found");

  const allTopics = await getAllTopics(request.subjectId);

  const topicList = allTopics
    .filter((t) => !request.topics || request.topics.includes(t.id))
    .map((t) => ({ id: String(t.id), name: String(t.name), subtopicCount: Array.isArray(t.children) ? t.children.length : 0 }));

  const totalDays = request.examDate
    ? Math.ceil((new Date(request.examDate).getTime() - new Date(request.startDate ?? Date.now()).getTime()) / (1000 * 60 * 60 * 24))
    : 30;

  const dailyHours = request.dailyHours ?? 2;
  const totalHours = dailyHours * totalDays;

  const systemPrompt = `${STUDY_PLAN_SYSTEM_PROMPT}

SUBJECT: ${subject.name}
TOTAL DAYS: ${totalDays}
DAILY HOURS: ${dailyHours}
TOTAL HOURS: ${totalHours}
EXAM DATE: ${request.examDate ? new Date(request.examDate).toLocaleDateString() : "Not specified"}

TOPICS TO COVER:
${topicList.map((t) => `- ${t.name} (${t.subtopicCount} subtopics)`).join("\n")}

Create a JSON study plan with dailyPlans array.`;

  try {
    const result = await provider.complete({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Create a ${totalDays}-day study plan.` },
      ],
      temperature: 0.4,
      maxTokens: 4000,
    });

    const planData = parseStudyPlanResponse(result.content, totalDays, subject.name, request.subjectId);

    // Save to database
    const plan = await prisma.studyPlan.create({
      data: {
        userId,
        subjectId: request.subjectId,
        name: request.name,
        examDate: request.examDate,
        totalHours,
        dailyHours,
        startDate: request.startDate ?? new Date(),
        endDate: request.examDate,
        status: "active",
        planData: JSON.stringify(planData.planData),
      },
    });

    // Create study goals
    if (request.dailyHours) {
      await prisma.studyGoal.create({
        data: {
          userId,
          subjectId: request.subjectId,
          type: "daily",
          target: JSON.stringify({ minutes: Math.round(dailyHours * 60) }),
          periodStart: new Date(),
          periodEnd: request.examDate,
          isActive: true,
        },
      });
    }

    return { plan: { ...planData, id: plan.id } };
  } catch (err) {
    log.error("study-planner-failed", { subjectId: request.subjectId, error: (err as Error).message });
    throw new Error(`Failed to generate study plan: ${(err as Error).message}`);
  }
}

type TopicNode = {
  id: string;
  name: string;
  children?: TopicNode[];
};

async function getAllTopics(subjectId: string): Promise<TopicNode[]> {
  const topics = await prisma.topic.findMany({
    where: { subjectId },
    include: { children: true },
  });

  const result: TopicNode[] = [];
  for (const topic of topics) {
    result.push({ id: topic.id, name: topic.name, children: topic.children.map((child) => ({ id: child.id, name: child.name, children: [] })) });
    if (topic.children.length > 0) {
      result.push(...await getAllTopicsForChildren(topic.id));
    }
  }
  return result;
}

async function getAllTopicsForChildren(parentId: string): Promise<TopicNode[]> {
  const children = await prisma.topic.findMany({
    where: { parentId },
    include: { children: true },
  });

  const result: TopicNode[] = [];
  for (const child of children) {
    result.push({ id: child.id, name: child.name, children: child.children.map((grandChild) => ({ id: grandChild.id, name: grandChild.name, children: [] })) });
    if (child.children.length > 0) {
      result.push(...await getAllTopicsForChildren(child.id));
    }
  }
  return result;
}

function parseStudyPlanResponse(
  content: string,
  totalDays: number,
  subjectName: string,
  subjectId: string
): StudyPlanData {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found");
    const parsed = JSON.parse(jsonMatch[0]);

    const dailyPlans: StudyPlanDaily[] = (parsed.dailyPlans || []).map((day: Record<string, unknown>, i: number) => ({
      date: new Date((day.date as string) ?? new Date(Date.now() + i * 24 * 60 * 60 * 1000).toISOString()),
      topics: ((day.topics as Record<string, unknown>[]) || []).map((t) => ({
        topicId: (t.topicId as string) ?? "",
        topicName: (t.topicName as string) ?? "",
        durationMinutes: (t.durationMinutes as number) ?? 60,
        activities: ((t.activities as Record<string, unknown>[]) || []).map((a) => ({
          type: (a.type as string) ?? "read",
          ...a,
        })),
      })),
      totalMinutes: (day.totalMinutes as number) ?? 90,
    }));

    return {
      id: "",
      userId: "",
      subjectId,
      name: `${subjectName} Study Plan`,
      examDate: undefined,
      totalHours: dailyPlans.reduce((sum: number, d: { totalMinutes: number }) => sum + d.totalMinutes, 0) / 60,
      dailyHours: dailyPlans.length > 0 ? dailyPlans[0].totalMinutes / 60 : 2,
      startDate: new Date(),
      endDate: undefined,
      status: "active",
      planData: dailyPlans,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (err) {
    log.error("study-plan-parse-failed", { error: (err as Error).message });
    // Return a basic fallback plan
    return createFallbackPlan(totalDays, subjectId, subjectName);
  }
}

function createFallbackPlan(totalDays: number, subjectId: string, subjectName: string): StudyPlanData {
  const dailyPlans: StudyPlanDaily[] = [];

  for (let i = 0; i < totalDays; i++) {
    const date = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    dailyPlans.push({
      date,
      topics: [{
        topicId: "",
        topicName: `Day ${i + 1} Study`,
        durationMinutes: 120,
        activities: [
          { type: "read", topicId: "", durationMinutes: 45 },
          { type: "mcq", count: 10, durationMinutes: 30 },
          { type: "flashcard", count: 20, durationMinutes: 20 },
          { type: "summary", topicId: "", durationMinutes: 15 },
        ],
      }],
      totalMinutes: 120,
    });
  }

  return {
    id: "",
    userId: "",
    subjectId,
    name: `${subjectName} Study Plan`,
    totalHours: totalDays * 2,
    dailyHours: 2,
    startDate: new Date(),
    endDate: new Date(Date.now() + totalDays * 24 * 60 * 60 * 1000),
    status: "active",
    planData: dailyPlans,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getStudyPlan(planId: string, userId: string): Promise<StudyPlanData | null> {
  const plan = await prisma.studyPlan.findFirst({
    where: { id: planId, userId },
  });

  if (!plan) return null;

  return {
    id: plan.id,
    userId: plan.userId,
    subjectId: plan.subjectId,
    name: plan.name,
    examDate: plan.examDate ?? undefined,
    totalHours: plan.totalHours ?? undefined,
    dailyHours: plan.dailyHours ?? undefined,
    startDate: plan.startDate,
    endDate: plan.endDate ?? undefined,
    status: plan.status as StudyPlanData["status"],
    planData: plan.planData ? JSON.parse(plan.planData) : [],
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export async function updateStudyPlanProgress(
  planId: string,
  userId: string,
  completedDate: string,
  completedActivities: string[]
): Promise<void> {
  const plan = await prisma.studyPlan.findFirst({
    where: { id: planId, userId },
  });

  if (!plan) throw new Error("Study plan not found");

  const progressData = plan.planData ? JSON.parse(plan.planData) : [];
  const dayIndex = progressData.findIndex((d: Record<string, unknown>) => d.date === completedDate);

  if (dayIndex >= 0) {
    progressData[dayIndex].completed = true;
    progressData[dayIndex].completedActivities = completedActivities;

    await prisma.studyPlan.update({
      where: { id: planId },
      data: { planData: JSON.stringify(progressData) },
    });
  }
}
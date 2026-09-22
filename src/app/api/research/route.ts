import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import { runResearchWorkflow, getDefaultConfigForMode } from "@/workflows/research-workflow";
import { z } from "zod";
import { audit } from "@/security/audit";
import { rateLimit, rateLimitHeaders } from "@/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const createSchema = z.object({
  topic: z.string().min(3).max(500),
  goal: z.string().max(2000).optional(),
  projectId: z.string().cuid().optional().nullable(),
  mode: z.enum(["quick", "standard", "deep"]).optional(),
});

export async function POST(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const rl = await rateLimit(`research:${authed.user.id}`, { limit: 6, windowMs: 60_000, prefix: "research" });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests.", code: "RATE_LIMITED" }, { status: 429, headers: rateLimitHeaders(rl) });

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

  if (parsed.data.projectId) {
    const proj = await prisma.project.findFirst({ where: { id: parsed.data.projectId, userId: authed.user.id } });
    if (!proj) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  await audit("research.start", { userId: authed.user.id }, { topic: parsed.data.topic.slice(0, 120), mode: parsed.data.mode ?? "standard" });

  const config = getDefaultConfigForMode(parsed.data.mode ?? "standard");
  const output = await runResearchWorkflow({
    userId: authed.user.id,
    topic: parsed.data.topic,
    goal: parsed.data.goal,
    projectId: parsed.data.projectId,
    mode: parsed.data.mode,
    config,
  });

  return NextResponse.json(output, { status: 200 });
}

export async function GET(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
  const sessions = await prisma.researchSession.findMany({
    where: { userId: authed.user.id, ...(projectId ? { projectId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, topic: true, goal: true, status: true, createdAt: true, completedAt: true, _count: { select: { sources: true } } },
  });

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      topic: s.topic,
      goal: s.goal,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
      sourceCount: s._count.sources,
    })),
  });
}
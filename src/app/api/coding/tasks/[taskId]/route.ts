import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ taskId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;
  const { taskId } = await params;

  const task = await prisma.codingTask.findFirst({
    where: { id: taskId, userId: authed.user.id },
    include: {
      workspace: { select: { id: true, name: true } },
      plans: { orderBy: { createdAt: "desc" } },
      changes: { orderBy: { createdAt: "asc" } },
      patches: { orderBy: { createdAt: "asc" } },
      testRuns: { orderBy: { createdAt: "desc" }, take: 10 },
      checkpoints: { orderBy: { createdAt: "desc" }, take: 10 },
      snapshots: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  let plan = null;
  try {
    plan = task.plan ? JSON.parse(task.plan) : null;
  } catch {
    /* ignore */
  }
  let result = null;
  try {
    result = task.result ? JSON.parse(task.result) : null;
  } catch {
    /* ignore */
  }

  return NextResponse.json({ task: { ...task, plan, result } });
}
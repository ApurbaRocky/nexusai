import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? undefined;
  const tasks = await prisma.codingTask.findMany({
    where: { userId: authed.user.id, ...(workspaceId ? { workspaceId } : {}) },
    include: { workspace: { select: { id: true, name: true } }, _count: { select: { changes: true, testRuns: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ tasks });
}
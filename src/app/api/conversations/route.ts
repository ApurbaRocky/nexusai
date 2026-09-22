import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import type { ConversationSummary } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const search = url.searchParams.get("q")?.trim();

  const conversations = await prisma.conversation.findMany({
    where: {
      userId: authed.user.id,
      archived: false,
      ...(projectId ? { projectId } : {}),
      ...(search ? { title: { contains: search } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, updatedAt: true, createdAt: true, agentId: true, model: true },
  });

  const items: ConversationSummary[] = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    agentId: c.agentId,
    model: c.model,
  }));

  return NextResponse.json({ conversations: items });
}

export async function POST(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const body = (await request.json().catch(() => ({}))) as { title?: string; agentId?: string; model?: string; projectId?: string };

  if (body.projectId) {
    const proj = await prisma.project.findFirst({ where: { id: body.projectId, userId: authed.user.id } });
    if (!proj) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const conversation = await prisma.conversation.create({
    data: {
      userId: authed.user.id,
      title: body.title?.trim().slice(0, 80) || "New Chat",
      agentId: body.agentId ?? null,
      model: body.model ?? null,
      projectId: body.projectId ?? null,
    },
  });

  return NextResponse.json({ id: conversation.id, title: conversation.title }, { status: 201 });
}
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import type { ChatSource, MessageRecord } from "@/types";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({ where: { id, userId: authed.user.id } });
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
      provider: true,
      model: true,
      agent: true,
      status: true,
      error: true,
      attachments: true,
      meta: true,
    },
  });

  const items: MessageRecord[] = messages.map((m) => {
    const meta = safeJson<{ sources?: ChatSource[]; toolCalls?: unknown[]; promptTokens?: number; completionTokens?: number }>(m.meta);
    return {
      id: m.id,
      role: m.role as MessageRecord["role"],
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      provider: m.provider,
      model: m.model,
      agent: m.agent,
      status: m.status,
      error: m.error,
      attachments: safeJson<MessageRecord["attachments"]>(m.attachments) ?? null,
      sources: meta?.sources,
      tokens: meta?.promptTokens != null || meta?.completionTokens != null ? { prompt: meta?.promptTokens, completion: meta?.completionTokens, total: (meta?.promptTokens ?? 0) + (meta?.completionTokens ?? 0) } : undefined,
    };
  });

  return NextResponse.json({
    conversation: { id: conversation.id, title: conversation.title, agentId: conversation.agentId, model: conversation.model },
    messages: items,
  });
}

export async function PATCH(request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({ where: { id, userId: authed.user.id } });
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { title?: string; agentId?: string; model?: string };
  const updated = await prisma.conversation.update({
    where: { id },
    data: {
      ...(typeof body.title === "string" && body.title.trim() ? { title: body.title.trim().slice(0, 80) } : {}),
      ...(typeof body.agentId === "string" ? { agentId: body.agentId } : {}),
      ...(typeof body.model === "string" ? { model: body.model } : {}),
    },
  });

  return NextResponse.json({ ok: true, id: updated.id, title: updated.title });
}

export async function DELETE(request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({ where: { id, userId: authed.user.id } });
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  await prisma.conversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

function safeJson<T>(json?: string | null): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}
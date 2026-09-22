import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const existing = await prisma.project.findFirst({ where: { id, userId: authed.user.id } });
  if (!existing) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

  const updated = await prisma.project.update({
    where: { id },
    data: { name: parsed.data.name, description: parsed.data.description ?? existing.description },
  });

  return NextResponse.json({ ok: true, project: { id: updated.id, name: updated.name, description: updated.description } });
}

export async function DELETE(_request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const existing = await prisma.project.findFirst({ where: { id, userId: authed.user.id } });
  if (!existing) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function GET(_request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const project = await prisma.project.findFirst({ where: { id, userId: authed.user.id } });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const [documents, conversations, memories, reportCount] = await Promise.all([
    prisma.document.findMany({ where: { projectId: id }, orderBy: { updatedAt: "desc" }, select: { id: true, filename: true, mimeType: true, sizeBytes: true, status: true, createdAt: true } }),
    prisma.conversation.findMany({ where: { projectId: id, archived: false }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, updatedAt: true } }),
    prisma.memory.findMany({ where: { projectId: id, enabled: true }, select: { id: true, content: true, type: true } }),
    prisma.report.count({ where: { projectId: id } }),
  ]);

  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    },
    documents: documents.map((d) => ({ id: d.id, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes, status: d.status, createdAt: d.createdAt.toISOString() })),
    conversations: conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() })),
    memories: memories.map((m) => ({ id: m.id, content: m.content, type: m.type })),
    reportCount,
  });
}
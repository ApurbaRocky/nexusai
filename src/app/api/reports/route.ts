import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(500_000),
  format: z.enum(["markdown", "txt"]).default("markdown"),
  projectId: z.string().cuid().optional().nullable(),
  conversationId: z.string().cuid().optional().nullable(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(_request: NextRequest) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;

  const reports = await prisma.report.findMany({
    where: { userId: authed.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, title: true, format: true, createdAt: true, projectId: true },
  });

  return NextResponse.json({
    reports: reports.map((r) => ({ id: r.id, title: r.title, format: r.format, createdAt: r.createdAt.toISOString(), projectId: r.projectId })),
  });
}

export async function POST(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

  if (parsed.data.projectId) {
    const proj = await prisma.project.findFirst({ where: { id: parsed.data.projectId, userId: authed.user.id } });
    if (!proj) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const report = await prisma.report.create({
    data: {
      userId: authed.user.id,
      title: parsed.data.title,
      format: parsed.data.format,
      content: parsed.data.content,
      projectId: parsed.data.projectId ?? null,
      conversationId: parsed.data.conversationId ?? null,
      meta: parsed.data.meta ? JSON.stringify(parsed.data.meta) : null,
    },
  });

  return NextResponse.json({ id: report.id, title: report.title, format: report.format }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing report id." }, { status: 422 });

  const existing = await prisma.report.findFirst({ where: { id, userId: authed.user.id } });
  if (!existing) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  await prisma.report.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import { CodingAgent } from "@/agents/coding/agent";
import { audit } from "@/security/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const patchSchema = z.object({
  permissionLevel: z.string().optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  ignorePatterns: z.array(z.string()).optional(),
});

export async function GET(_request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const [workspace, files, tasks, changes, snapshots] = await Promise.all([
    prisma.codingWorkspace.findFirst({ where: { id, userId: authed.user.id } }),
    prisma.codebaseFile.findMany({ where: { workspaceId: id }, orderBy: { path: "asc" }, take: 500, select: { id: true, path: true, language: true, sizeBytes: true, lineCount: true, hash: true, isTest: true, isConfig: true, isDoc: true, updatedAt: true } }),
    prisma.codingTask.findMany({ where: { workspaceId: id }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, title: true, mode: true, status: true, createdAt: true, completedAt: true } }),
    prisma.codingChange.findMany({ where: { workspaceId: id }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, taskId: true, filePath: true, action: true, status: true, summary: true, diffPreview: true, oldContent: true, newContent: true, remark: true, createdAt: true } }),
    prisma.codingSnapshot.findMany({ where: { workspaceId: id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, reason: true, taskId: true, createdAt: true } }),
  ]);

  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });

  let stats = null;
  try {
    stats = workspace.stats ? JSON.parse(workspace.stats) : null;
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    workspace: { ...workspace, stats },
    files,
    tasks,
    changes,
    snapshots,
    counts: {
      files: files.length,
      tasks: tasks.length,
      changes: changes.length,
    },
  });
}

export async function PATCH(request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const ws = await prisma.codingWorkspace.findFirst({ where: { id, userId: authed.user.id } });
  if (!ws) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

  const data: Record<string, unknown> = {};
  if (parsed.data.permissionLevel !== undefined) data.permissionLevel = parsed.data.permissionLevel;
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.ignorePatterns !== undefined) data.ignorePatterns = JSON.stringify(parsed.data.ignorePatterns);

  const updated = await prisma.codingWorkspace.update({ where: { id }, data });
  return NextResponse.json({ ok: true, workspace: updated });
}

export async function DELETE(_request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const ws = await prisma.codingWorkspace.findFirst({ where: { id, userId: authed.user.id } });
  if (!ws) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });

  await CodingAgent.deleteWorkspace(authed.user.id, id);
  await audit("coding.workspace.delete", { userId: authed.user.id }, { workspaceId: id });
  return NextResponse.json({ ok: true });
}
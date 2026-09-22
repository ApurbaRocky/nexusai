import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import { listMemories, addMemory } from "@/memory/service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  content: z.string().min(1).max(4000),
  type: z.enum(["long_term", "project", "preference"]).default("long_term"),
  projectId: z.string().cuid().optional().nullable(),
});

export async function GET(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
  const items = await listMemories(authed.user.id, projectId);
  return NextResponse.json({
    // Redact obvious secrets by policy.
    items: items.map((m) => ({
      ...m,
      content: /api[_ -]?key|password|bearer |secret|token\b/i.test(m.content) ? "(redacted user memory containing sensitive value)" : m.content,
    })),
  });
}

export async function POST(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

  if (parsed.data.projectId) {
    const project = await prisma.project.findFirst({ where: { id: parsed.data.projectId, userId: authed.user.id }, select: { id: true } });
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const item = await addMemory(authed.user.id, {
    content: parsed.data.content,
    type: parsed.data.type,
    projectId: parsed.data.projectId ?? undefined,
    source: "explicit",
  });

  return NextResponse.json({ item }, { status: 201 });
}
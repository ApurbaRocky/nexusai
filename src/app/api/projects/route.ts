import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import { z } from "zod";
import { audit } from "@/security/audit";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(""),
});

export async function GET(_request: NextRequest) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;

  const projects = await prisma.project.findMany({
    where: { userId: authed.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { conversations: true, documents: true } },
    },
  });

  return NextResponse.json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      conversationCount: p._count.conversations,
      documentCount: p._count.documents,
    })),
  });
}

export async function POST(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

  const project = await prisma.project.create({
    data: { userId: authed.user.id, name: parsed.data.name.trim(), description: parsed.data.description },
  });
  await audit("project.create", { userId: authed.user.id });

  return NextResponse.json({ project: { id: project.id, name: project.name, description: project.description } }, { status: 201 });
}
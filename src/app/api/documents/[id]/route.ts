import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import { getVectorStore } from "@/rag/vector-store";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const doc = await prisma.document.findFirst({
    where: { id, userId: authed.user.id },
    select: { id: true, filename: true, mimeType: true, sizeBytes: true, status: true, error: true, extractedText: true, createdAt: true, projectId: true },
  });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const chunkCount = await prisma.documentChunk.count({ where: { documentId: id } });

  return NextResponse.json({
    document: {
      id: doc.id,
      filename: doc.filename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      status: doc.status,
      error: doc.error,
      chunkCount,
      createdAt: doc.createdAt.toISOString(),
      projectId: doc.projectId,
      textPreview: doc.extractedText?.slice(0, 12_000) ?? "",
    },
  });
}

export async function DELETE(_request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const existing = await prisma.document.findFirst({ where: { id, userId: authed.user.id } });
  if (!existing) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  await getVectorStore().deleteByDocument(id);
  await prisma.documentChunk.deleteMany({ where: { documentId: id } });
  await prisma.document.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
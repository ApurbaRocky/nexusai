import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { ALLOWED_UPLOAD_MIME, UPLOAD_MAX_BYTES } from "@/config";
import { prisma } from "@/database/client";
import { extractText } from "@/rag/text-extraction";
import { indexDocument } from "@/rag/service";
import { audit } from "@/security/audit";
import { rateLimit, rateLimitHeaders } from "@/security/rate-limit";
import { log } from "@/utils/log";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const docs = await prisma.document.findMany({
    where: {
      userId: authed.user.id,
      ...(projectId ? { projectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, filename: true, mimeType: true, sizeBytes: true, status: true, createdAt: true },
  });
  return NextResponse.json({
    documents: docs.map((d) => ({ id: d.id, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes, status: d.status, createdAt: d.createdAt.toISOString() })),
  });
}

export async function POST(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const rl = await rateLimit(`documents:${authed.user.id}`, { limit: 10, windowMs: 60_000, prefix: "docs" });
  if (!rl.ok) return NextResponse.json({ error: "Too many uploads.", code: "RATE_LIMITED" }, { status: 429, headers: rateLimitHeaders(rl) });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid upload." }, { status: 422 });
  const file = form.get("file");
  const projectId = (form.get("projectId") as string | null) ?? null;

  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 422 });
  if (file.size > UPLOAD_MAX_BYTES) return NextResponse.json({ error: "File too large (max 25 MB)." }, { status: 413 });
  const mime = file.type || guessMimeFromName(file.name);
  if (!ALLOWED_UPLOAD_MIME.has(mime)) {
    return NextResponse.json({ error: `File type "${mime}" is not allowed.` }, { status: 415 });
  }

  if (projectId) {
    const proj = await prisma.project.findFirst({ where: { id: projectId, userId: authed.user.id } });
    if (!proj) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Signature sanity check for a few formats (defense in depth vs MIME spoofing).
  const sigOk = checkSignature(buffer, mime);
  if (!sigOk) return NextResponse.json({ error: "File content does not match its declared type." }, { status: 415 });

  const document = await prisma.document.create({
    data: {
      userId: authed.user.id,
      projectId,
      filename: sanitizeFilename(file.name),
      mimeType: mime,
      sizeBytes: file.size,
      status: "processing",
    },
  });

  try {
    const { text } = await extractText(buffer, { mime, filename: file.name });
    await prisma.document.update({
      where: { id: document.id },
      data: { extractedText: text, status: "ready" },
    });
    await audit("document.upload", { userId: authed.user.id }, { documentId: document.id, mime });
    log.info("document-uploaded", { documentId: document.id, mime, size: file.size });

    // Kick off RAG indexing without blocking the response.
    void indexDocument(document.id).then((r) => {
      log.info("document-indexed", { documentId: document.id, status: r.status, chunks: r.chunks });
    });

    return NextResponse.json(
      {
        document: { id: document.id, filename: document.filename, mimeType: mime, sizeBytes: file.size, status: "ready" },
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not process file";
    await prisma.document.update({ where: { id: document.id }, data: { status: "error", error: message } });
    log.error("document-upload-failed", { documentId: document.id, error: message });
    return NextResponse.json({ error: message, code: "PROCESSING_FAILED" }, { status: 422 });
  }
}

function sanitizeFilename(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 200);
  return clean || "upload.bin";
}

function guessMimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

function checkSignature(buffer: Buffer, mime: string): boolean {
  const head = buffer.subarray(0, 12);
  switch (mime) {
    case "application/pdf":
      return head.subarray(0, 5).toString("ascii") === "%PDF-";
    case "image/png":
      return head.subarray(0, 4).toString("hex") === "89504e47";
    case "image/jpeg":
      return head.subarray(0, 3).toString("hex") === "ffd8ff";
    default:
      return true; // text formats: encoding check at extraction
  }
}
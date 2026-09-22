import { auth } from "@/auth/auth";
import { NextRequest, NextResponse } from "next/server";
import { audit, type AuditContext } from "@/security/audit";
import { rateLimit, rateLimitHeaders } from "@/security/rate-limit";
import { prisma } from "@/database/client";
import { memoryService } from "@/memory/service";
import { log } from "@/utils/log";
import { z } from "zod";

export const runtime = "nodejs";

const exportSchema = z.object({
  memoryIds: z.array(z.string()).min(1).max(100),
  format: z.enum(["JSON", "CSV", "MARKDOWN"]),
});

function getAuthContext(req: NextRequest): AuditContext {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const ctx = getAuthContext(req);

  const rl = await rateLimit(`memory:export:${userId}`, { limit: 5, windowMs: 60_000, prefix: "memory" }, ctx);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  try {
    const body = await req.json();
    const validated = exportSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json({ error: validated.error.flatten().fieldErrors }, { status: 422 });
    }

    const { memoryIds, format } = validated.data;

    // Verify ownership and get memories
    const memories = await Promise.all(
      memoryIds.map((id) => memoryService.getMemory(id, userId))
    );

    const validMemories = memories.filter((m): m is NonNullable<typeof m> => m !== null);

    if (validMemories.length === 0) {
      return NextResponse.json({ error: "No valid memories found" }, { status: 404 });
    }

    let content: string;
    let contentType: string;
    let filename: string;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    switch (format) {
      case "JSON":
        content = JSON.stringify(validMemories, null, 2);
        contentType = "application/json";
        filename = `memory-export-${timestamp}.json`;
        break;
      case "CSV":
        const headers = ["id", "type", "scope", "title", "content", "summary", "importance", "confidence", "tags", "entities", "privacyLevel", "status", "createdAt", "updatedAt"];
        const rows = validMemories.map((m) => [
          m.id,
          m.type,
          m.scope,
          m.title ?? "",
          m.content.replace(/"/g, '""'),
          m.summary ?? "",
          m.importance.toString(),
          m.confidence.toString(),
          m.tags.join(";"),
          m.entities.join(";"),
          m.privacyLevel,
          m.status,
          m.createdAt.toISOString(),
          m.updatedAt.toISOString(),
        ]);
        content = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
        contentType = "text/csv";
        filename = `memory-export-${timestamp}.csv`;
        break;
      case "MARKDOWN":
        content = validMemories
          .map(
            (m) => `## ${m.title ?? "Memory"}\n\n**Type:** ${m.type} | **Scope:** ${m.scope} | **Importance:** ${m.importance} | **Confidence:** ${m.confidence}\n\n**Tags:** ${m.tags.join(", ") || "none"}\n\n**Entities:** ${m.entities.join(", ") || "none"}\n\n**Content:**\n${m.content}\n\n---\n`
          )
          .join("\n");
        contentType = "text/markdown";
        filename = `memory-export-${timestamp}.md`;
        break;
      default:
        return NextResponse.json({ error: "Invalid format" }, { status: 422 });
    }

    // Log export
    await prisma.memoryExport.create({
      data: {
        userId,
        memoryId: validMemories[0].id,
        format,
        content,
      },
    });

    await audit("memory.exported", { userId, ...ctx }, {
      memoryCount: validMemories.length,
      format,
    });

    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    log.error("memory-export-failed", { error: (err as Error).message });
    return NextResponse.json({ error: "Failed to export memories" }, { status: 500 });
  }
}
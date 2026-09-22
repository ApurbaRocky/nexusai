import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth/auth";
import { rateLimit, rateLimitHeaders } from "@/security/rate-limit";
import { memoryService } from "@/memory/service";
import { log } from "@/utils/log";
import { z } from "zod";
import type { MemoryType, MemoryScope } from "@/memory/types";

export const runtime = "nodejs";

const createMemorySchema = z.object({
  type: z.enum(["USER_PROFILE", "PREFERENCE", "PROJECT", "CONVERSATION", "TASK", "DOCUMENT", "RESEARCH", "EDUCATION", "CODING", "BROWSER"]),
  scope: z.enum(["GLOBAL_USER", "PROJECT", "CONVERSATION", "TASK", "DOCUMENT_COLLECTION", "AGENT", "SESSION"]).optional(),
  content: z.string().min(1).max(50000),
  title: z.string().max(200).optional(),
  summary: z.string().max(1000).optional(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  projectId: z.string().optional(),
  conversationId: z.string().optional(),
  taskId: z.string().optional(),
  documentId: z.string().optional(),
  sourceType: z.enum(["conversation", "document", "research", "task", "education", "coding", "browser", "user_explicit", "agent_inference"]),
  sourceId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  entities: z.array(z.string()).optional(),
  privacyLevel: z.enum(["NORMAL", "PRIVATE", "HIGHLY_PRIVATE"]).optional(),
  userVisible: z.boolean().optional(),
  userConfirmed: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});

function getAuthContext(req: NextRequest) {
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

  const rl = await rateLimit(`memory:create:${userId}`, { limit: 30, windowMs: 60_000, prefix: "memory" }, ctx);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  try {
    const body = await req.json();
    const validated = createMemorySchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json({ error: validated.error.flatten().fieldErrors }, { status: 422 });
    }

    const input = validated.data;
    const scope = input.scope ?? (input.projectId ? "PROJECT" : "GLOBAL_USER");

    const memory = await memoryService.createMemory({
      userId,
      type: input.type,
      scope: scope as MemoryScope,
      content: input.content,
      title: input.title,
      summary: input.summary,
      importance: input.importance,
      confidence: input.confidence,
      projectId: input.projectId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      documentId: input.documentId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      tags: input.tags,
      entities: input.entities,
      privacyLevel: input.privacyLevel,
      userVisible: input.userVisible,
      userConfirmed: input.userConfirmed,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    }, ctx);

    return NextResponse.json(memory, { status: 201 });
  } catch (err) {
    log.error("memory-create-failed", { error: (err as Error).message });
    return NextResponse.json({ error: "Failed to create memory" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { searchParams } = new URL(req.url);

  const query = searchParams.get("q") ?? "";
  const types = searchParams.get("types")?.split(",") as MemoryType[];
  const scopes = searchParams.get("scopes")?.split(",") as MemoryScope[];
  const projectId = searchParams.get("projectId") ?? undefined;
  const conversationId = searchParams.get("conversationId") ?? undefined;
  const taskId = searchParams.get("taskId") ?? undefined;
  const minImportance = parseFloat(searchParams.get("minImportance") ?? "0");
  const minConfidence = parseFloat(searchParams.get("minConfidence") ?? "0");
  const maxResults = parseInt(searchParams.get("maxResults") ?? "20", 10);
  const includeArchived = searchParams.get("includeArchived") === "true";
  const includeExpired = searchParams.get("includeExpired") === "true";

  const results = await memoryService.searchMemories({
    userId,
    query,
    types,
    scopes,
    projectId,
    conversationId,
    taskId,
    minImportance,
    minConfidence,
    maxResults,
    includeArchived,
    includeExpired,
  });

  return NextResponse.json(results);
}
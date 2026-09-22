import { auth } from "@/auth/auth";
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitHeaders } from "@/security/rate-limit";
import { memoryService } from "@/memory/service";
import { log } from "@/utils/log";
import { z } from "zod";

export const runtime = "nodejs";

const updateMemorySchema = z.object({
  content: z.string().max(50000).optional(),
  title: z.string().max(200).optional(),
  summary: z.string().max(1000).optional(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).optional(),
  entities: z.array(z.string()).optional(),
  privacyLevel: z.enum(["NORMAL", "PRIVATE", "HIGHLY_PRIVATE"]).optional(),
  userVisible: z.boolean().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "EXPIRED", "DELETED"]).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

function getAuthContext(req: NextRequest) {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;
  const ctx = getAuthContext(req);

  try {
    const memory = await memoryService.getMemory(id, userId, ctx);
    if (!memory) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    // Get versions
    const versions = await memoryService.getMemoryVersions(id, userId);

    return NextResponse.json({ memory, versions });
  } catch (err) {
    log.error("memory-get-failed", { error: (err as Error).message });
    return NextResponse.json({ error: "Failed to get memory" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;
  const ctx = getAuthContext(req);

  const rl = await rateLimit(`memory:update:${userId}`, { limit: 50, windowMs: 60_000, prefix: "memory" }, ctx);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  try {
    const body = await req.json();
    const validated = updateMemorySchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json({ error: validated.error.flatten().fieldErrors }, { status: 422 });
    }

    const memory = await memoryService.updateMemory(id, userId, {
      ...validated.data,
      expiresAt: validated.data.expiresAt ? new Date(validated.data.expiresAt) : undefined,
    }, ctx);

    if (!memory) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    return NextResponse.json(memory);
  } catch (err) {
    log.error("memory-update-failed", { error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;
  const ctx = getAuthContext(req);

  const rl = await rateLimit(`memory:delete:${userId}`, { limit: 20, windowMs: 60_000, prefix: "memory" }, ctx);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  try {
    const success = await memoryService.deleteMemory(id, userId, ctx);
    if (!success) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("memory-delete-failed", { error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
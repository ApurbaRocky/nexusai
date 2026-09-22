import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { runTool } from "@/tools/execute";
import { getAgent } from "@/agents/agents/registry";
import { z } from "zod";
import { requestContext } from "@/security/audit";
import { rateLimit, rateLimitHeaders } from "@/security/rate-limit";

export const dynamic = "force-dynamic";

const executeSchema = z.object({
  toolName: z.string().min(1).max(80),
  args: z.record(z.string(), z.unknown()).default({}),
  conversationId: z.string().cuid().optional().nullable(),
  projectId: z.string().cuid().optional().nullable(),
  documentIds: z.array(z.string()).max(20).optional(),
  agent: z.string().max(80).optional().nullable(),
  confirmed: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const rl = await rateLimit(`tools:${authed.user.id}`, { limit: 30, windowMs: 60_000, prefix: "tools" }, requestContext(request.headers));
  if (!rl.ok) return NextResponse.json({ error: "Too many requests.", code: "RATE_LIMITED" }, { status: 429, headers: rateLimitHeaders(rl) });

  const body = await request.json().catch(() => null);
  const parsed = executeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

  const agent = parsed.data.agent ? getAgent(parsed.data.agent) : null;
  const result = await runTool({
    userId: authed.user.id,
    toolName: parsed.data.toolName,
    args: parsed.data.args,
    conversationId: parsed.data.conversationId ?? undefined,
    projectId: parsed.data.projectId ?? undefined,
    documentIds: parsed.data.documentIds,
    agent,
    confirmed: parsed.data.confirmed,
    requestId: crypto.randomUUID(),
  });

  const status = result.permission === "denied" && !result.ok ? 403 : result.ok ? 200 : 422;
  return NextResponse.json({
    ok: result.ok,
    permission: result.permission,
    toolName: result.toolName,
    content: result.content,
    data: result.data,
    riskLevel: result.riskLevel,
    durationMs: result.durationMs,
  }, { status });
}
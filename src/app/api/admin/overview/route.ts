import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authed = await guard(request, { role: "admin" });
  if (authed instanceof NextResponse) return authed;

  const days = 14;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [userCount, conversationCount, messageCount, usageRows, toolRows, auditRows, errorCount, providerUsage] = await Promise.all([
    prisma.user.count(),
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.apiUsage.aggregate({
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, durationMs: true },
    }),
    prisma.toolCall.count({ where: { createdAt: { gte: since } } }),
    prisma.auditLog.findMany({ where: { createdAt: { gte: since }, category: "security" }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.message.count({ where: { status: "error" } }),
    prisma.apiUsage.groupBy({ by: ["provider", "model"], _sum: { totalTokens: true }, orderBy: { _sum: { totalTokens: "desc" } }, take: 10 }),
  ]);

  const lastDay = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const messages24h = await prisma.message.count({ where: { createdAt: { gte: lastDay } } });
  const requests24h = await prisma.apiUsage.count({ where: { createdAt: { gte: lastDay } } });

  return NextResponse.json({
    overview: {
      users: userCount,
      activeConversations: conversationCount,
      messages: messageCount,
      messages24h,
      aiRequests24h: requests24h,
      totalTokens: usageRows._sum.totalTokens ?? 0,
      promptTokens: usageRows._sum.promptTokens ?? 0,
      completionTokens: usageRows._sum.completionTokens ?? 0,
      totalAiMs: usageRows._sum.durationMs ?? 0,
      toolCalls7d: toolRows,
      errors: errorCount,
    },
    tokenUsageByModel: providerUsage.map((p) => ({ provider: p.provider ?? "unknown", model: p.model ?? "unknown", tokens: p._sum.totalTokens ?? 0 })),
    recentSecurityEvents: auditRows.map((a) => ({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt.toISOString(),
      meta: a.meta ? safeParse(a.meta) : null,
    })),
    windowDays: days,
  });
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
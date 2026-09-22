import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import { parseResearch } from "@/agents/research/json-persistence";
import { classifySourceType, extractDomain } from "@/agents/research/research-types";
import type {
  Conflict,
  ResearchConfig,
  ResearchCost,
  ResearchFinding,
  ResearchPlan,
  ResearchProgress,
  ResearchReport,
} from "@/agents/research/research-types";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const session = await prisma.researchSession.findFirst({
    where: { id, userId: authed.user.id },
    include: { sources: { orderBy: { relevance: "desc" } } },
  });
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  // Every JSON column is parsed defensively: a single corrupt artefact must not
  // turn the whole session view into a 500.
  const config = parseResearch<Partial<ResearchConfig>>(session.config, {});
  const report = parseResearch<ResearchReport | undefined>(session.report, undefined);

  return NextResponse.json({
    session: {
      id: session.id,
      topic: session.topic,
      goal: session.goal,
      status: session.status,
      mode: config.mode ?? "standard",
      plan: parseResearch<ResearchPlan | undefined>(session.plan, undefined),
      // The UI renders the markdown body, not the report envelope.
      report: report?.markdown ?? null,
      createdAt: session.createdAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
      sources: session.sources.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url,
        domain: extractDomain(source.url),
        sourceType: classifySourceType(source.url, source.title, source.snippet ?? ""),
        provider: source.provider,
        publishedAt: source.publishedAt?.toISOString() ?? null,
        snippet: source.snippet,
        relevance: source.relevance,
        verified: source.verified,
      })),
      progress: parseResearch<ResearchProgress | null>(session.progress, null),
      cost: parseResearch<ResearchCost | null>(session.cost, null),
      findings: parseResearch<ResearchFinding[]>(session.findings, []),
      conflicts: parseResearch<Conflict[]>(session.conflicts, []),
    },
  });
}

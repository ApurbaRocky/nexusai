import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth/auth";
import { knowledgeGraphService } from "@/memory/knowledge-graph";
import { log } from "@/utils/log";
import type { KnowledgeEntityType, KnowledgeRelationshipType } from "@/memory/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { searchParams } = new URL(req.url);

  const entityName = searchParams.get("entityName") ?? undefined;
  const entityType = searchParams.get("entityType") as KnowledgeEntityType | undefined;
  const relationshipType = searchParams.get("relationshipType") as KnowledgeRelationshipType | undefined;
  const maxDepth = parseInt(searchParams.get("maxDepth") ?? "2", 10);
  const maxResults = parseInt(searchParams.get("maxResults") ?? "20", 10);

  try {
    const result = await knowledgeGraphService.searchGraph({
      userId,
      entityName,
      entityType,
      relationshipType,
      maxDepth,
      maxResults,
    });

    return NextResponse.json(result);
  } catch (err) {
    log.error("knowledge-graph-search-failed", { error: (err as Error).message });
    return NextResponse.json({ error: "Failed to search knowledge graph" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "summary") {
      const summary = await knowledgeGraphService.getUserGraphSummary(userId);
      return NextResponse.json(summary);
    }

    if (action === "neighbors") {
      const { entityId, maxDepth = 1 } = body as { entityId?: string; maxDepth?: number };
      if (!entityId) {
        return NextResponse.json({ error: "entityId is required" }, { status: 422 });
      }
      const neighbors = await knowledgeGraphService.getEntityNeighbors(userId, entityId, maxDepth);
      return NextResponse.json(neighbors);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 422 });
  } catch (err) {
    log.error("knowledge-graph-action-failed", { error: (err as Error).message });
    return NextResponse.json({ error: "Failed to execute action" }, { status: 500 });
  }
}
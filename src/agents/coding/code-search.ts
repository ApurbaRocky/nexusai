/**
 * CodeSearchEngine — exact/substring, word, symbol and semantic search over an
 * indexed workspace. Exact/word/symbol hits are computed from the persisted
 * index (CodebaseFile.content + CodeSymbol); semantic hits reuse the shared
 * RAG vector store (Search = embedding similarity, deterministic fallback).
 */
import { prisma } from "@/database/client";
import type { CodeSearchHit } from "@/agents/coding/types";
import { getVectorStore } from "@/rag/vector-store";
import { getEmbeddingProvider } from "@/rag/embeddings";

export interface SearchOptions {
  query: string;
  mode?: "exact" | "word" | "symbol" | "semantic" | "auto";
  limit?: number;
}

export async function codeSearch(workspaceId: string, userId: string, opts: SearchOptions): Promise<CodeSearchHit[]> {
  const q = opts.query.trim();
  if (!q) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));

  const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId }, select: { id: true } });
  if (!ws) throw new Error("Workspace not found.");

  const mode = opts.mode ?? "auto";

  if (mode === "symbol") return searchSymbols(workspaceId, q, limit);

  const exactHits = await searchText(workspaceId, q, mode === "word" ? "word" : "exact", limit);
  if (mode === "exact" || mode === "word") return exactHits;

  const semanticHits = await searchSemantic(workspaceId, userId, q, limit);
  const merged = mergeHits(exactHits, semanticHits);
  return normalized(merged.slice(0, limit));
}

async function searchText(workspaceId: string, q: string, how: "exact" | "word", limit: number): Promise<CodeSearchHit[]> {
  const tokens = how === "word" ? q.toLowerCase().split(/\s+/).filter(Boolean) : null;
  const files = await prisma.codebaseFile.findMany({
    where: { workspaceId },
    select: { id: true, path: true, content: true },
    take: 300,
  });

  const hits: CodeSearchHit[] = [];
  for (const file of files) {
    if (!file.content) continue;
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match = false;
      if (how === "word" && tokens) {
        const low = line.toLowerCase();
        match = tokens.every((t) => low.includes(t));
      } else {
        match = line.includes(q);
      }
      if (match) {
        hits.push({ path: file.path, line: i + 1, content: line.length > 400 ? line.slice(0, 400) : line, kind: how === "word" ? "word" : "exact" });
        if (hits.length >= limit * 4) break;
      }
    }
    if (hits.length >= limit * 4) break;
  }
  return hits.slice(0, limit);
}

async function searchSymbols(workspaceId: string, q: string, limit: number): Promise<CodeSearchHit[]> {
  const syms = await prisma.codeSymbol.findMany({
    where: { workspaceId, name: { contains: q } },
    select: { name: true, kind: true, lineStart: true, file: { select: { path: true } } },
    orderBy: { lineStart: "asc" },
    take: limit * 2,
  });
  return syms.map((s) => ({
    path: s.file.path,
    line: s.lineStart,
    content: `${s.name} (${s.kind})`,
    kind: "symbol" as const,
  }));
}

async function searchSemantic(workspaceId: string, userId: string, q: string, limit: number): Promise<CodeSearchHit[]> {
  try {
    const store = getVectorStore();
    const embedder = await getEmbeddingProvider();
    const [vec] = await embedder.embed([q]);
    const docs = await prisma.document.findMany({
      where: { userId, meta: { contains: `"codingWorkspaceId":"${workspaceId}"` } },
      select: { id: true },
    });
    if (!docs.length) return [];
    const results = await store.search(vec, { topK: limit * 3, documentIds: docs.map((d) => d.id), minSimilarity: 0.2 });
    return results.map((r) => {
      const firstLine = r.content.split("\n")[0]?.slice(0, 200) ?? "";
      const lineHint = extractLineHint(r.content);
      return {
        path: r.filename,
        line: lineHint,
        content: firstLine,
        kind: "semantic" as const,
      };
    });
  } catch {
    return [];
  }
}

function extractLineHint(content: string): number {
  // Best-effort: find the first "line N:" style marker if we stored one.
  const m = /^\/\/\s*line:\s*(\d+)/.exec(content);
  return m ? Number(m[1]) : 1;
}

function mergeHits(a: CodeSearchHit[], b: CodeSearchHit[]): CodeSearchHit[] {
  const seen = new Set<string>();
  const out: CodeSearchHit[] = [];
  for (const h of [...a, ...b]) {
    const key = `${h.path}:${h.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

function normalized(hits: CodeSearchHit[]) {
  return hits;
}
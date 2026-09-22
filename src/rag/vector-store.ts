/**
 * Vector store implementations.
 *
 * - `SqliteVectorStore` (default, local dev): stores embedding vectors as
 *   JSON text and computes cosine similarity in-process. Replaceable.
 * - PostgreSQL uses the same JSON embedding representation for portability.
 *   It is correct for production correctness, while a future pgvector adapter
 *   can optimize search without changing the VectorStore contract.
 */
import { prisma } from "@/database/client";
import { cosineSimilarity } from "@/rag/embeddings";
import type { RetrievedContext, VectorStore } from "@/rag/types";
import { log } from "@/utils/log";

export class SqliteVectorStore implements VectorStore {
  readonly kind = "sqlite" as const;

  async upsert(chunk: { id: string; documentId: string; index: number; content: string; tokenCount?: number }, embedding: number[]) {
    const meta = await prisma.document
      .findUnique({ where: { id: chunk.documentId } })
      .then((d) => d?.meta ?? null);
    const parsed = parseMeta(meta);
    void parsed;
    await prisma.documentChunk.upsert({
      where: { documentId_index: { documentId: chunk.documentId, index: chunk.index } },
      create: {
        documentId: chunk.documentId,
        index: chunk.index,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: JSON.stringify(embedding),
      },
      update: { content: chunk.content, tokenCount: chunk.tokenCount, embedding: JSON.stringify(embedding) },
    });
  }

  async search(
    queryEmbedding: number[],
    options: { topK: number; documentIds?: string[]; minSimilarity?: number },
  ): Promise<RetrievedContext[]> {
    const rows = await prisma.documentChunk.findMany({
      where: options.documentIds?.length ? { documentId: { in: options.documentIds } } : {},
      take: 2000,
      select: { id: true, documentId: true, index: true, content: true, pageNumber: true, embedding: true, document: { select: { filename: true } } },
    });

    const results: RetrievedContext[] = [];
    const minSim = options.minSimilarity ?? 0.15;
    for (const row of rows) {
      if (!row.embedding) continue;
      let vec: number[];
      try {
        vec = JSON.parse(row.embedding) as number[];
      } catch {
        continue;
      }
      const sim = cosineSimilarity(queryEmbedding, vec);
      if (sim < minSim) continue;
      results.push({
        documentId: row.documentId,
        filename: row.document.filename,
        chunkIndex: row.index,
        page: row.pageNumber ?? undefined,
        content: row.content,
        similarity: sim,
      });
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, options.topK);
  }

  async deleteByDocument(documentId: string) {
    await prisma.documentChunk.deleteMany({ where: { documentId } });
  }
}

/** PostgreSQL-compatible JSON embedding store. */
export class PgVectorStore implements VectorStore {
  readonly kind = "pgvector" as const;
  async upsert(chunk: { id: string; documentId: string; index: number; content: string; tokenCount?: number }, embedding: number[]) {
    await prisma.documentChunk.upsert({
      where: { documentId_index: { documentId: chunk.documentId, index: chunk.index } },
      create: {
        documentId: chunk.documentId,
        index: chunk.index,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: JSON.stringify(embedding),
      },
      update: { content: chunk.content, tokenCount: chunk.tokenCount, embedding: JSON.stringify(embedding) },
    });
  }
  async search(queryEmbedding: number[], options: { topK: number; documentIds?: string[]; minSimilarity?: number }): Promise<RetrievedContext[]> {
    const rows = await prisma.documentChunk.findMany({
      where: options.documentIds?.length ? { documentId: { in: options.documentIds } } : {},
      take: 2000,
      select: { documentId: true, index: true, content: true, pageNumber: true, embedding: true, document: { select: { filename: true } } },
    });
    const results: RetrievedContext[] = [];
    const minSimilarity = options.minSimilarity ?? 0.15;
    for (const row of rows) {
      if (!row.embedding) continue;
      try {
        const similarity = cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[]);
        if (similarity >= minSimilarity) {
          results.push({ documentId: row.documentId, filename: row.document.filename, chunkIndex: row.index, page: row.pageNumber ?? undefined, content: row.content, similarity });
        }
      } catch {
        // Ignore malformed historical embeddings and continue retrieval.
      }
    }
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, options.topK);
  }
  async deleteByDocument(documentId: string): Promise<void> {
    await prisma.documentChunk.deleteMany({ where: { documentId } });
  }
}

let instance: VectorStore | null = null;

export function getVectorStore(): VectorStore {
  if (!instance) {
    const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
    instance = url.startsWith("postgres") ? new PgVectorStore() : new SqliteVectorStore();
    log.info("vector-store", { kind: instance.kind });
  }
  return instance;
}

function parseMeta(meta: string | null): Record<string, unknown> {
  if (!meta) return {};
  try {
    return JSON.parse(meta) as Record<string, unknown>;
  } catch {
    return {};
  }
}
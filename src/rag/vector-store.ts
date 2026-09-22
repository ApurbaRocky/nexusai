/**
 * Vector store implementations.
 *
 * - `SqliteVectorStore` (default, local dev): stores embedding vectors as
 *   JSON text and computes cosine similarity in-process. Replaceable.
 * - Postgres deployment path: switch to pgvector by adding the `vector`
 *   column + HNSW/IVFFlat index via raw SQL and a `PgVectorStore` adapter
 *   implementing the same interface (documented as an integration point).
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

/** pgvector integration point (Postgres). Interface-compatible. */
export class PgVectorStore implements VectorStore {
  readonly kind = "pgvector" as const;
  constructor(private _dimension = 1536) {}
  async upsert(): Promise<void> {
    throw new Error("pgvector store is an integration point — configure the vector column and index, then implement upsert/search.");
  }
  async search(): Promise<RetrievedContext[]> {
    throw new Error("pgvector store is an integration point.");
  }
  async deleteByDocument(): Promise<void> {
    throw new Error("pgvector store is an integration point.");
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
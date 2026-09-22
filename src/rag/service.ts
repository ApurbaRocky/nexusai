/**
 * RAG service — end-to-end: document -> text extraction -> chunking ->
 * embeddings -> vector store -> semantic search -> relevant context.
 * Questions answered from documents reference document + page when possible.
 */
import { prisma } from "@/database/client";
import { chunkText } from "@/rag/chunking";
import { getEmbeddingProvider } from "@/rag/embeddings";
import { getVectorStore } from "@/rag/vector-store";
import type { RetrievedContext, VectorStore } from "@/rag/types";
import { log } from "@/utils/log";

/**
 * Index an uploaded/attached document: extract, chunk, embed, store.
 * Returns the updated document row (status ready/error).
 */
export async function indexDocument(
  documentId: string,
  options: { reindex?: boolean } = {},
): Promise<{ id: string; status: string; chunks: number }> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw new Error("Document not found.");

  if (options.reindex) {
    await getVectorStore().deleteByDocument(document.id);
  }

  try {
    const content = document.extractedText ?? await readStoredContent(documentId);
    if (!content) {
      throw new Error("Document has no retrievable text content.");
    }

    const chunks = chunkText(content);
    const store = getVectorStore();

    const embedder = await getEmbeddingProvider();
    const texts = chunks.map((c) => c.content);
    let vectors: number[][];
    try {
      vectors = await embedder.embed(texts);
      log.info("rag-index-embed", { documentId, chunks: texts.length, provider: embedder.kind });
    } catch (err) {
      log.warn("rag-index-embed-failed", { documentId, error: (err as Error).message, provider: embedder.kind });
      throw new Error("Embedding service unavailable.");
    }

    for (let i = 0; i < chunks.length; i++) {
      await store.upsert(
        {
          id: `${document.id}:${chunks[i].index}`,
          documentId: document.id,
          index: chunks[i].index,
          content: chunks[i].content,
          tokenCount: chunks[i].tokenCount,
          metadata: {
            documentId: document.id,
            timestamp: Date.now(),
            filename: document.filename,
          },
        },
        vectors[i] ?? vectors[0],
      );
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { status: "ready", meta: JSON.stringify({ chunks: chunks.length, embedder: embedder.kind, indexedAt: new Date().toISOString() }) },
    });

    return { id: document.id, status: "ready", chunks: chunks.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "error", error: message },
    });
    log.error("rag-index-failed", { documentId, error: message });
    return { id: document.id, status: "error", chunks: 0 };
  }
}

async function readStoredContent(documentId: string): Promise<string | null> {
  const rows = await prisma.documentChunk.findMany({
    where: { documentId },
    orderBy: { index: "asc" },
    take: 2000,
    select: { content: true },
  });
  if (!rows.length) return null;
  return rows.map((r) => r.content).join("\n\n");
}

/**
 * Semantic retrieval with optional per-document scoring fusion.
 * Returns context blocks referencing document + page.
 */
export async function retrieveContext(
  query: string,
  options: {
    documentIds?: string[];
    topK?: number;
    minSimilarity?: number;
    store?: VectorStore;
  } = {},
): Promise<RetrievedContext[]> {
  const store = options.store ?? getVectorStore();
  const embedder = await getEmbeddingProvider();
  let queryVector: number[];
  try {
    const vectors = await embedder.embed([query]);
    queryVector = vectors[0];
  } catch {
    return []; // retrieval degrades gracefully when embeddings are unavailable
  }
  return store.search(queryVector, {
    topK: options.topK ?? 4,
    documentIds: options.documentIds,
    minSimilarity: options.minSimilarity ?? 0.15,
  });
}

export async function buildRagContextBlock(
  query: string,
  options: { documentIds?: string[]; topK?: number } = {},
): Promise<{ block: string; contexts: RetrievedContext[] }> {
  const contexts = await retrieveContext(query, options);
  if (!contexts.length) return { block: "", contexts };
  const block = contexts
    .map((c, i) => {
      const page = c.page ? ` (page ${c.page})` : "";
      return `[${i + 1}] Source: "${c.filename}"${page}\n${c.content}`;
    })
    .join("\n\n---\n\n");
  return { block, contexts };
}
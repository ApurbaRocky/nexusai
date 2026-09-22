/** RAG shared types. */
export interface Chunk {
  id: string;
  documentId: string;
  index: number;
  content: string;
  tokenCount?: number;
  embedding?: number[];
  metadata: {
    filename?: string;
    page?: number;
    source?: string;
    documentId: string;
    /** epoch ms */
    timestamp: number;
  };
}

export interface RetrievedContext {
  documentId: string;
  filename: string;
  chunkIndex: number;
  page?: number;
  content: string;
  similarity: number;
}

/** Vector store abstraction — replaceable (SQLite local / pgvector in Postgres). */
export interface VectorStore {
  readonly kind: "sqlite" | "pgvector" | "memory";
  upsert(chunk: Chunk, embedding: number[]): Promise<void>;
  search(queryEmbedding: number[], options: { topK: number; documentIds?: string[]; minSimilarity?: number }): Promise<RetrievedContext[]>;
  deleteByDocument(documentId: string): Promise<void>;
  healthCheck?(): Promise<boolean>;
}
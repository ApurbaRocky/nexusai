/**
 * Document Intelligence Types (Phase 3)
 * Core domain types for document processing, OCR, RAG, and knowledge base.
 */

export type DocumentStatus =
  | "pending"
  | "uploading"
  | "uploaded"
  | "extracting"
  | "ocr"
  | "chunking"
  | "embedding"
  | "indexing"
  | "indexed"
  | "ready"
  | "error"
  | "cancelled";

export type DocumentMimeType =
  | "application/pdf"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.ms-excel"
  | "text/csv"
  | "text/plain"
  | "text/markdown"
  | "application/json"
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export type ExtractableMime = DocumentMimeType;

export type OcrLanguage = "eng" | "ben" | "eng+ben" | "auto";

export type OcrProviderKind = "tesseract" | "cloud-vision" | "azure-ocr" | "none";

export type RerankerProviderKind = "cross-encoder" | "llm" | "none";

export interface DocumentMetadata {
  id: string;
  userId: string;
  projectId?: string;
  collectionId?: string;
  filename: string;
  originalFilename: string;
  mimeType: DocumentMimeType;
  sizeBytes: number;
  status: DocumentStatus;
  error?: string;
  language?: string;
  pageCount?: number;
  chunkCount?: number;
  extractedText?: string;
  ocrUsed?: boolean;
  ocrLanguage?: OcrLanguage;
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentPage {
  id: string;
  documentId: string;
  pageNumber: number;
  text: string;
  ocrUsed: boolean;
  ocrConfidence?: number;
  ocrLanguage?: OcrLanguage;
  createdAt: Date;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  pageNumber: number;
  section?: string;
  text: string;
  chunkIndex: number;
  tokenCount: number;
  embedding?: number[];
  charStart?: number;
  charEnd?: number;
  createdAt: Date;
}

export interface DocumentEmbedding {
  id: string;
  chunkId: string;
  vector: number[];
  dimension: number;
  model: string;
  createdAt: Date;
}

export interface ProcessingJob {
  id: string;
  documentId: string;
  userId: string;
  type: "extract" | "ocr" | "chunk" | "embed" | "index" | "full";
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  currentStage?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface DocumentCollection {
  id: string;
  userId: string;
  name: string;
  description?: string;
  documentIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtractResult {
  text: string;
  pageCount?: number;
  pages?: { pageNumber: number; text: string }[];
  usedOcr?: boolean;
  ocrLanguage?: OcrLanguage;
  ocrConfidence?: number;
  metadata?: Record<string, unknown>;
}

export interface OcrResult {
  text: string;
  confidence: number;
  language: string;
  pageNumber?: number;
  words?: OcrWord[];
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
  respectBoundaries?: boolean;
}

export interface ChunkResult {
  text: string;
  index: number;
  tokenCount: number;
  pageNumber?: number;
  section?: string;
  charStart?: number;
  charEnd?: number;
}

export interface RetrievalOptions {
  documentIds?: string[];
  collectionId?: string;
  topK?: number;
  minSimilarity?: number;
  useKeywordSearch?: boolean;
  useSemanticSearch?: boolean;
  rerank?: boolean;
  filters?: Record<string, unknown>;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentFilename: string;
  pageNumber?: number;
  section?: string;
  text: string;
  similarity: number;
  keywordScore?: number;
  rerankScore?: number;
}

export interface RerankOptions {
  query: string;
  chunks: RetrievedChunk[];
  topK?: number;
}

export interface RerankResult {
  chunks: RetrievedChunk[];
}

export interface DocumentSearchOptions {
  query: string;
  documentIds?: string[];
  collectionId?: string;
  page?: number;
  limit?: number;
  filters?: Record<string, unknown>;
}

export interface DocumentSearchResult {
  documentId: string;
  filename: string;
  mimeType: string;
  pageNumber?: number;
  matchedText: string;
  context: string;
}

export interface DocumentChatOptions {
  question: string;
  documentIds: string[];
  collectionId?: string;
  includeGeneralKnowledge?: boolean;
  stream?: boolean;
}

export interface DocumentChatResult {
  answer: string;
  citations: DocumentCitation[];
  sources: RetrievedChunk[];
  usedGeneralKnowledge: boolean;
}

export interface DocumentCitation {
  id: string;
  documentId: string;
  documentFilename: string;
  pageNumber?: number;
  chunkIndex: number;
  excerpt: string;
  relevance: number;
}

export interface DocumentComparisonOptions {
  documentIds: string[];
  question?: string;
  mode: "summary" | "differences" | "contradictions" | "common-themes" | "data";
}

export interface DocumentComparisonResult {
  comparison: string;
  documents: { id: string; filename: string; summary: string }[];
  findings: ComparisonFinding[];
}

export interface ComparisonFinding {
  type: "common" | "different" | "contradiction" | "unique";
  description: string;
  documents: { id: string; excerpt: string }[];
  confidence: number;
}

export interface StudyModeOptions {
  documentIds: string[];
  mode: "mcq" | "short-questions" | "long-questions" | "viva" | "flashcards" | "summary" | "exam-notes" | "important-topics" | "practice-test";
  count?: number;
  difficulty?: "easy" | "medium" | "hard";
  language?: "en" | "bn" | "mixed";
  chapter?: string;
}

export interface StudyModeResult {
  content: string;
  items: StudyItem[];
}

export interface StudyItem {
  type: "mcq" | "question" | "flashcard" | "topic";
  question?: string;
  answer?: string;
  options?: string[];
  correctIndex?: number;
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
  pageReference?: number;
}

export interface DocumentSummaryOptions {
  documentIds: string[];
  type: "quick" | "detailed" | "academic" | "exam" | "bullet" | "executive";
  length?: "short" | "medium" | "long";
  language?: "en" | "bn" | "mixed";
}

export interface DocumentSummaryResult {
  summary: string;
  keyPoints: string[];
  citations: DocumentCitation[];
}

export interface UploadProgress {
  fileId: string;
  filename: string;
  progress: number;
  stage: DocumentStatus;
  error?: string;
}

export interface FileValidationResult {
  valid: boolean;
  mimeType?: DocumentMimeType;
  error?: string;
  warnings?: string[];
}

export interface SecurityScanResult {
  safe: boolean;
  threats?: string[];
  details?: Record<string, unknown>;
}

export interface DocumentProcessingConfig {
  maxFileSizeBytes: number;
  maxPages: number;
  maxConcurrentJobs: number;
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string;
  embeddingDimension: number;
  ocrLanguages: OcrLanguage[];
  ocrProvider: OcrProviderKind;
  rerankerProvider: RerankerProviderKind;
  enableOcr: boolean;
  enableReranking: boolean;
  enableKeywordSearch: boolean;
  enableSemanticSearch: boolean;
  minSimilarity: number;
  maxRetrievalChunks: number;
}
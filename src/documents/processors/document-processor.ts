/**
 * Document Processor (Phase 3)
 * Orchestrates the full document processing pipeline:
 * VALIDATE -> EXTRACT -> OCR (if needed) -> CHUNK -> EMBED -> INDEX
 */
import { prisma } from "@/database/client";
import { extractText } from "@/rag/text-extraction";
import { chunkText } from "@/rag/chunking";
import { getEmbeddingProvider } from "@/rag/embeddings";
import { getVectorStore } from "@/rag/vector-store";
import { getOcrProvider } from "@/documents/ocr/provider";
import { sanitizeExtractedText } from "@/documents/security/validation";
import type {
  DocumentStatus,
  DocumentMimeType,
  OcrLanguage,
} from "@/documents/types";
import { log } from "@/utils/log";

interface ProcessingOptions {
  documentId: string;
  userId: string;
  ocrLanguage?: OcrLanguage;
  forceOcr?: boolean;
  reindex?: boolean;
}

interface ProcessingResult {
  success: boolean;
  documentId: string;
  status: DocumentStatus;
  pageCount?: number;
  chunkCount?: number;
  error?: string;
}

export class DocumentProcessor {
  private jobId?: string;

  async process(options: ProcessingOptions): Promise<ProcessingResult> {
    const { documentId, userId, ocrLanguage = "eng+ben", forceOcr = false, reindex = false } = options;

    try {
      // Create processing job for tracking
      this.jobId = await this.createJob(documentId, userId, "full");

      await this.updateJobProgress(0, "validating");
      await this.updateDocumentStatus(documentId, "extracting");

      // Get document
      const document = await prisma.document.findUnique({ where: { id: documentId } });
      if (!document) throw new Error("Document not found");

      // Validate ownership
      if (document.userId !== userId) throw new Error("Unauthorized");

      // Check if already processed and not reindexing
      if (document.status === "ready" && !reindex && !forceOcr) {
        return { success: true, documentId, status: "ready" as DocumentStatus, pageCount: document.pageCount ?? undefined, chunkCount: document.chunkCount ?? undefined };
      }

      // If reindexing, clean up old vectors
      if (reindex) {
        await getVectorStore().deleteByDocument(documentId);
        await prisma.documentChunk.deleteMany({ where: { documentId } });
      }

      await this.updateJobProgress(10, "extracting");

      // Read file from storage (in this implementation, we assume file is accessible via a path or we re-extract)
      // For now, we need to fetch the file - in production this would be from object storage
      const buffer = await this.getDocumentBuffer();
      if (!buffer) throw new Error("Document file not found");

      // Extract text
      let extractResult: import("@/rag/text-extraction").ExtractResult;
      try {
        extractResult = await extractText(buffer, {
          mime: (document.mimeType ?? "application/octet-stream") as DocumentMimeType,
          filename: document.filename,
          ocrLanguage,
        });
      } catch (extractErr) {
        throw new Error(`Text extraction failed: ${(extractErr as Error).message}`);
      }

      await this.updateJobProgress(30, "ocr");

      // Check if OCR is needed (scanned PDF or image)
      const mimeType = document.mimeType ?? "application/octet-stream";
      const needsOcr = forceOcr ||
        (mimeType === "application/pdf" && (extractResult.metadata as Record<string, unknown> | undefined)?.scanned === true) ||
        mimeType.startsWith("image/");

      let finalText = extractResult.text;
      let finalPages = extractResult.pages ?? [];
      let ocrUsed = extractResult.usedOcr ?? false;

      if (needsOcr && !extractResult.usedOcr) {
        try {
          const ocrProvider = getOcrProvider();
          await ocrProvider.initialize();

          // For PDFs, we'd need to render pages to images first
          // For now, we only OCR images directly
          if (mimeType.startsWith("image/")) {
            const ocrResult = await ocrProvider.extractText(buffer, {
              mime: mimeType as DocumentMimeType,
              language: ocrLanguage,
            });

            finalText = sanitizeExtractedText(ocrResult.text);
            finalPages = [{ pageNumber: 1, text: ocrResult.text }];
            ocrUsed = true;
          }
          // For scanned PDFs, we'd need a PDF renderer - that's a future enhancement
        } catch (ocrErr) {
          log.warn("ocr-failed", { documentId, error: (ocrErr as Error).message });
          // Continue with extracted text even if OCR fails
        }
      }

      await this.updateJobProgress(50, "chunking");

      // Chunk the text
      const chunks = chunkText(finalText, {
        chunkSize: 1200,
        overlap: 200,
      });

      // Map chunks to pages
      const chunksWithPages = this.mapChunksToPages(chunks, finalPages);

      await this.updateJobProgress(70, "embedding");

      // Generate embeddings
      const embedder = await getEmbeddingProvider();
      const texts = chunksWithPages.map(c => c.content);
      let vectors: number[][];

      try {
        vectors = await embedder.embed(texts);
      } catch (embedErr) {
        throw new Error(`Embedding failed: ${(embedErr as Error).message}`);
      }

      await this.updateJobProgress(85, "indexing");

      // Store chunks in database and vector store
      const store = getVectorStore();
      const chunkRecords = [];

      for (let i = 0; i < chunksWithPages.length; i++) {
        const chunk = chunksWithPages[i];
        const vector = vectors[i] ?? vectors[0];

        // Store in database
        const dbChunk = await prisma.documentChunk.create({
          data: {
            documentId,
            index: chunk.index,
            content: chunk.content,
            pageNumber: chunk.pageNumber,
            tokenCount: chunk.tokenCount,
            embedding: JSON.stringify(vector),
          },
        });

        chunkRecords.push(dbChunk);

        // Store in vector store
        await store.upsert(
          {
            id: `${documentId}:${chunk.index}`,
            documentId,
            index: chunk.index,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            metadata: {
              documentId,
              timestamp: Date.now(),
              filename: document.filename,
              page: chunk.pageNumber,
            },
          },
          vector,
        );
      }

      await this.updateJobProgress(95, "finalizing");

      // Update document status
      await prisma.document.update({
        where: { id: documentId },
        data: {
          status: "ready",
          extractedText: finalText,
          pageCount: extractResult.pageCount ?? finalPages.length,
          chunkCount: chunksWithPages.length,
          ocrUsed,
          ocrLanguage: ocrUsed ? ocrLanguage : null,
          meta: JSON.stringify({
            chunks: chunksWithPages.length,
            embedder: embedder.kind,
            indexedAt: new Date().toISOString(),
            pages: finalPages.length,
            ocrUsed,
          }),
        },
      });

      await this.updateJobProgress(100, "completed");
      await this.completeJob(true);

      log.info("document-processed", { documentId, chunks: chunksWithPages.length, pages: finalPages.length, ocrUsed });

      return {
        success: true,
        documentId,
        status: "ready",
        pageCount: extractResult.pageCount ?? finalPages.length,
        chunkCount: chunksWithPages.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      await this.handleError(documentId, message);
      return { success: false, documentId, status: "error", error: message };
    }
  }

  private async getDocumentBuffer(): Promise<Buffer | null> {
    // In a real implementation, this would fetch from object storage (S3, GCS, etc.)
    // For now, we'll need to store the file content somewhere accessible
    // This is a placeholder - in production, implement proper file storage.

    // For demo purposes, we'll return null - the actual file handling
    // would be done via the upload API which has the buffer
    return null;
  }

  private mapChunksToPages(
    chunks: { content: string; index: number; tokenCount: number }[],
    pages: { pageNumber: number; text: string }[]
  ): { content: string; index: number; tokenCount: number; pageNumber: number }[] {
    if (pages.length === 0) {
      return chunks.map(c => ({ ...c, pageNumber: 1 }));
    }

    const result = [];
    let charPosition = 0;

    for (const chunk of chunks) {
      // Find which page this chunk belongs to
      let pageNumber = 1;

      for (let i = 0; i < pages.length; i++) {
        const pageTextLength = pages[i].text.length;
        if (charPosition < pageTextLength || i === pages.length - 1) {
          pageNumber = pages[i].pageNumber;
          break;
        }
        charPosition -= pageTextLength;
      }

      result.push({ ...chunk, pageNumber });
      charPosition += chunk.content.length;
    }

    return result;
  }

  private async createJob(documentId: string, userId: string, type: "full" | "extract" | "ocr" | "chunk" | "embed" | "index"): Promise<string> {
    const job = await prisma.processingJob.create({
      data: {
        documentId,
        userId,
        type,
        status: "running",
        progress: 0,
        currentStage: "queued",
        startedAt: new Date(),
      },
    });
    this.jobId = job.id;
    return job.id;
  }

  private async updateJobProgress(progress: number, stage: string): Promise<void> {
    if (!this.jobId) return;
    await prisma.processingJob.update({
      where: { id: this.jobId },
      data: { progress, currentStage: stage },
    });
  }

  private async completeJob(success: boolean): Promise<void> {
    if (!this.jobId) return;
    await prisma.processingJob.update({
      where: { id: this.jobId },
      data: {
        status: success ? "completed" : "failed",
        progress: success ? 100 : undefined,
        completedAt: new Date(),
      },
    });
  }

  private async updateDocumentStatus(documentId: string, status: DocumentStatus, error?: string): Promise<void> {
    await prisma.document.update({
      where: { id: documentId },
      data: { status, error },
    });
  }

  private async handleError(documentId: string, error: string): Promise<void> {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "error", error },
    });
    if (this.jobId) {
      await prisma.processingJob.update({
        where: { id: this.jobId },
        data: { status: "failed", completedAt: new Date() },
      });
    }
    log.error("document-processing-failed", { documentId, error });
  }
}

export async function processDocument(options: ProcessingOptions): Promise<ProcessingResult> {
  const processor = new DocumentProcessor();
  return processor.process(options);
}
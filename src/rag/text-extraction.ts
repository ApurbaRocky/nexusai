/**
 * Document text extraction (Phase 3)
 * Supports: plain text, markdown, CSV, JSON, PDF, DOCX, PPTX, XLSX, CSV, images (OCR).
 */
import { ToolUnavailableError } from "@/tools/types";
import { sanitizeExtractedText } from "@/documents/security/validation";

export type ExtractableMime =
  | "text/plain"
  | "text/markdown"
  | "text/csv"
  | "application/json"
  | "application/pdf"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.ms-excel"
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export interface ExtractResult {
  text: string;
  pageCount?: number;
  pages?: { pageNumber: number; text: string }[];
  usedOcr?: boolean;
  ocrLanguage?: string;
  ocrConfidence?: number;
  metadata?: Record<string, unknown>;
}

export interface TextExtractor {
  readonly mimeTypes: string[];
  extract(buffer: Buffer, options?: { mime?: string; filename?: string }): Promise<ExtractResult>;
}

class PlainTextExtractor implements TextExtractor {
  readonly mimeTypes = ["text/plain", "text/markdown", "application/json"];
  async extract(buffer: Buffer, options?: { mime?: string }): Promise<ExtractResult> {
    let text = buffer.toString("utf8");
    if (options?.mime === "application/json") {
      try {
        const parsed = JSON.parse(text);
        text = JSON.stringify(parsed, null, 2);
      } catch {
        // keep raw
      }
    }
    return { text: sanitizeExtractedText(text) };
  }
}

// Lazy-load heavy extractors
let pdfExtractor: TextExtractor | null = null;
let docxExtractor: TextExtractor | null = null;
let pptxExtractor: TextExtractor | null = null;
let xlsxExtractor: TextExtractor | null = null;
let imageOcrExtractor: TextExtractor | null = null;

async function getPdfExtractor() {
  if (!pdfExtractor) {
    const mod = await import("@/documents/extractors/pdf-extractor");
    pdfExtractor = new mod.PdfExtractor();
  }
  return pdfExtractor;
}

async function getDocxExtractor() {
  if (!docxExtractor) {
    const mod = await import("@/documents/extractors/docx-extractor");
    docxExtractor = new mod.DocxExtractor();
  }
  return docxExtractor;
}

async function getPptxExtractor() {
  if (!pptxExtractor) {
    const mod = await import("@/documents/extractors/pptx-extractor");
    pptxExtractor = new mod.PptxExtractor();
  }
  return pptxExtractor;
}

async function getXlsxExtractor() {
  if (!xlsxExtractor) {
    const mod = await import("@/documents/extractors/xlsx-extractor");
    xlsxExtractor = new mod.XlsxExtractor();
  }
  return xlsxExtractor;
}

async function getImageOcrExtractor() {
  if (!imageOcrExtractor) {
    const mod = await import("@/documents/extractors/image-ocr-extractor");
    imageOcrExtractor = new mod.ImageOcrExtractor();
  }
  return imageOcrExtractor;
}

const EXTRACTOR_MAP: Record<string, () => Promise<TextExtractor>> = {
  "application/pdf": () => getPdfExtractor(),
  "application/msword": () => getDocxExtractor(),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": () => getDocxExtractor(),
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": () => getPptxExtractor(),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": () => getXlsxExtractor(),
  "application/vnd.ms-excel": () => getXlsxExtractor(),
  "text/csv": () => getXlsxExtractor(),
  "image/png": () => getImageOcrExtractor(),
  "image/jpeg": () => getImageOcrExtractor(),
  "image/webp": () => getImageOcrExtractor(),
  "text/plain": () => Promise.resolve(new PlainTextExtractor()),
  "text/markdown": () => Promise.resolve(new PlainTextExtractor()),
  "application/json": () => Promise.resolve(new PlainTextExtractor()),
};

export function extractorFor(mime: string): Promise<TextExtractor | undefined> {
  const factory = EXTRACTOR_MAP[mime];
  if (!factory) return Promise.resolve(undefined);
  return factory();
}

/** Top-level extraction; text is sanitized as untrusted content. */
export async function extractText(
  buffer: Buffer,
  options: { mime?: string; filename?: string; ocrLanguage?: string } = {},
): Promise<ExtractResult> {
  const mime = options.mime ?? "text/plain";
  const extractor = await extractorFor(mime);
  if (!extractor) throw new ToolUnavailableError("extraction", `Unsupported file type: ${mime}`);

  const result = await extractor.extract(buffer, options);
  return { ...result, text: sanitizeExtractedText(result.text) };
}
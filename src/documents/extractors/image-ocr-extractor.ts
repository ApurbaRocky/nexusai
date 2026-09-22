/**
 * Image OCR Extractor (Phase 3)
 * Extracts text from images using OCR provider.
 */
import type { ExtractResult, ExtractableMime } from "@/rag/text-extraction";
import type { DocumentMimeType, OcrLanguage } from "@/documents/types";
import { checkFileSignature, sanitizeExtractedText } from "@/documents/security/validation";
import { getOcrProvider } from "@/documents/ocr/provider";

interface OcrOptions {
  mime?: string;
  filename?: string;
  ocrLanguage?: OcrLanguage;
}

export class ImageOcrExtractor {
  readonly mimeTypes: ExtractableMime[] = ["image/png", "image/jpeg", "image/webp"];

  async extract(buffer: Buffer, options?: OcrOptions): Promise<ExtractResult> {
    const mime = (options?.mime as DocumentMimeType) ?? "image/png";

    if (!checkFileSignature(buffer, mime)) {
      throw new Error(`Invalid ${mime} file signature`);
    }

    const provider = getOcrProvider();
    await provider.initialize();

    const language = options?.ocrLanguage ?? "eng+ben";

    try {
      const result = await provider.extractText(buffer, { mime, language });

      return {
        text: sanitizeExtractedText(result.text),
        pageCount: 1,
        pages: [{ pageNumber: 1, text: result.text }],
        usedOcr: true,
        ocrLanguage: language,
        ocrConfidence: result.confidence,
        metadata: {
          words: result.words,
        },
      };
    } catch (err) {
      throw new Error(`Image OCR failed: ${(err as Error).message}`);
    }
  }
}

export async function extractImageOcrText(buffer: Buffer, options?: { mime?: string; filename?: string }): Promise<ExtractResult> {
  const extractor = new ImageOcrExtractor();
  return extractor.extract(buffer, options);
}
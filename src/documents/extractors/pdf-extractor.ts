/**
 * PDF Text Extractor (Phase 3)
 * Uses pdf-parse (v2.4.5+) for text extraction with page-level detection.
 * For scanned PDFs, integrates with OCR provider.
 */
import { PDFParse } from "pdf-parse";
import type { ExtractResult, ExtractableMime } from "@/rag/text-extraction";
import { checkFileSignature, sanitizeExtractedText } from "@/documents/security/validation";

export class PdfExtractor {
  readonly mimeTypes: ExtractableMime[] = ["application/pdf"];

  async extract(buffer: Buffer): Promise<ExtractResult> {
    if (!checkFileSignature(buffer, "application/pdf")) {
      throw new Error("Invalid PDF file signature");
    }

    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const textResult = await parser.getText();

      const pages: { pageNumber: number; text: string }[] = [];
      let fullText = "";

      for (const page of textResult.pages) {
        const pageText = page.text ?? "";
        pages.push({ pageNumber: page.num, text: pageText });
        fullText += pageText + "\n\n";
      }

      const numPages = textResult.total;

      // Detect if PDF is likely scanned (very little extractable text)
      const textLength = fullText.trim().length;
      const charsPerPage = numPages > 0 ? textLength / numPages : 0;

      if (charsPerPage < 100 && numPages > 0) {
        // Likely scanned - would need OCR
        return {
          text: sanitizeExtractedText(fullText),
          pageCount: numPages,
          pages,
          usedOcr: false,
          ocrLanguage: undefined,
          metadata: {
            scanned: true,
            charsPerPage: Math.round(charsPerPage),
          },
        };
      }

      return {
        text: sanitizeExtractedText(fullText),
        pageCount: numPages,
        pages,
        usedOcr: false,
        metadata: {},
      };
    } catch (err) {
      throw new Error(`PDF extraction failed: ${(err as Error).message}`);
    }
  }
}

export async function extractPdfText(buffer: Buffer): Promise<ExtractResult> {
  const extractor = new PdfExtractor();
  return extractor.extract(buffer);
}
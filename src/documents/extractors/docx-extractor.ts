/**
 * DOCX Text Extractor (Phase 3)
 * Uses mammoth for DOCX extraction with structure preservation.
 */
import * as mammoth from "mammoth";
import type { ExtractResult, ExtractableMime, DocumentMimeType } from "@/documents/types";
import { checkFileSignature, sanitizeExtractedText } from "@/documents/security/validation";

interface DocxPage {
  pageNumber: number;
  text: string;
  headings: { level: number; text: string }[];
}

export class DocxExtractor {
  readonly mimeTypes: ExtractableMime[] = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
  ];

  async extract(buffer: Buffer, options?: { mime?: string; filename?: string }): Promise<ExtractResult> {
    const mime = options?.mime as DocumentMimeType;
    if (!checkFileSignature(buffer, mime)) {
      throw new Error(`Invalid ${mime === "application/msword" ? "DOC" : "DOCX"} file signature`);
    }

    try {
      const result = await mammoth.extractRawText({ buffer });
      const messages = result.messages;
      const text = result.value;

      if (messages.length > 0) {
        console.warn("DOCX extraction warnings:", messages);
      }

      // Also extract with structure for better chunking
      const structuredResult = await mammoth.convertToHtml({ buffer });
      const htmlText = structuredResult.value;

      // Try to detect page breaks from HTML (approximate)
      const pages = this.extractPagesFromHtml(htmlText, text);

      return {
        text: sanitizeExtractedText(text),
        pageCount: pages.length,
        pages,
        usedOcr: false,
        metadata: {
          messages: messages.map(m => ({ type: m.type, message: m.message })),
        },
      };
    } catch (err) {
      throw new Error(`DOCX extraction failed: ${(err as Error).message}`);
    }
  }

  private extractPagesFromHtml(html: string, plainText: string): DocxPage[] {
    // mammoth doesn't provide page numbers directly
    // We approximate based on content length or explicit page breaks
    const pages: DocxPage[] = [];

    // Look for explicit page breaks in HTML
    const pageBreakRegex = /<div[^>]*style="[^"]*page-break-after:\s*always[^"]*"[^>]*>/gi;
    const matches = [...html.matchAll(pageBreakRegex)];

    if (matches.length > 0) {
      for (let i = 0; i <= matches.length; i++) {
        const nextMatch = matches[i];
        const start = i === 0 ? 0 : matches[i - 1].index! + matches[i - 1][0].length;
        const end = nextMatch ? nextMatch.index : html.length;
        const pageHtml = html.slice(start, end);
        const pageText = this.htmlToText(pageHtml);
        pages.push({ pageNumber: i + 1, text: pageText, headings: this.extractHeadings(pageHtml) });
      }
    } else {
      // No explicit page breaks - approximate based on content length
      const approxPages = Math.max(1, Math.ceil(plainText.length / 3000));
      const chunkSize = Math.ceil(plainText.length / approxPages);

      for (let i = 0; i < approxPages; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, plainText.length);
        pages.push({
          pageNumber: i + 1,
          text: plainText.slice(start, end),
          headings: [],
        });
      }
    }

    return pages;
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<[^>]*>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&/g, "&")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, '"')
      .replace(/'/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private extractHeadings(html: string): { level: number; text: string }[] {
    const headings: { level: number; text: string }[] = [];
    const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi;
    let match;
    while ((match = headingRegex.exec(html)) !== null) {
      const level = parseInt(match[1], 10);
      const text = this.htmlToText(match[2]);
      if (text.trim()) {
        headings.push({ level, text: text.trim() });
      }
    }
    return headings;
  }
}

export async function extractDocxText(buffer: Buffer, options?: { mime?: string; filename?: string }): Promise<ExtractResult> {
  const extractor = new DocxExtractor();
  return extractor.extract(buffer, options);
}
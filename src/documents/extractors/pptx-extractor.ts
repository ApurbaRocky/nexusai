/**
 * PPTX Text Extractor (Phase 3)
 * Extracts text from PowerPoint presentations with slide numbers.
 * Uses a simple ZIP-based approach since PPTX is a ZIP of XML files.
 */
import * as JSZip from "jszip";
import type { ExtractResult, ExtractableMime } from "@/documents/types";
import { checkFileSignature, sanitizeExtractedText } from "@/documents/security/validation";

interface PptxSlide {
  slideNumber: number;
  text: string;
  notes?: string;
  shapes: { type: string; text: string }[];
}

export class PptxExtractor {
  readonly mimeTypes: ExtractableMime[] = [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ];

  async extract(buffer: Buffer): Promise<ExtractResult> {
    if (!checkFileSignature(buffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation")) {
      throw new Error("Invalid PPTX file signature");
    }

    try {
      const zip = await JSZip.loadAsync(buffer);
      const slides: PptxSlide[] = [];

      // Find all slide files
      const slideFiles = Object.keys(zip.files)
        .filter(name => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"))
        .sort((a, b) => {
          const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
          const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
          return numA - numB;
        });

      for (let i = 0; i < slideFiles.length; i++) {
        const slideFile = zip.files[slideFiles[i]];
        if (!slideFile) continue;

        const xml = await slideFile.async("text");
        const slide = this.parseSlideXml(xml, i + 1);
        slides.push(slide);
      }

      // Also extract notes
      const notesFiles = Object.keys(zip.files)
        .filter(name => name.startsWith("ppt/notesSlides/notesSlide") && name.endsWith(".xml"))
        .sort();

      for (let i = 0; i < notesFiles.length && i < slides.length; i++) {
        const notesFile = zip.files[notesFiles[i]];
        if (notesFile) {
          const xml = await notesFile.async("text");
          const notesText = this.extractNotesFromXml(xml);
          if (slides[i]) slides[i].notes = notesText;
        }
      }

      const pages = slides.map(s => ({
        pageNumber: s.slideNumber,
        text: s.text,
        notes: s.notes,
        shapes: s.shapes,
      }));

      const fullText = slides.map(s => {
        let text = `Slide ${s.slideNumber}:\n${s.text}`;
        if (s.notes) text += `\nNotes: ${s.notes}`;
        return text;
      }).join("\n\n");

      return {
        text: sanitizeExtractedText(fullText),
        pageCount: slides.length,
        pages,
        usedOcr: false,
        metadata: { slideCount: slides.length },
      };
    } catch (err) {
      throw new Error(`PPTX extraction failed: ${(err as Error).message}`);
    }
  }

  private parseSlideXml(xml: string, slideNumber: number): PptxSlide {
    const shapes: { type: string; text: string }[] = [];
    let text = "";

    // Extract text from a:t elements (text runs)
    const textRegex = /<a:t[^>]*>([^<]+)<\/a:t>/g;
    let match;
    while ((match = textRegex.exec(xml)) !== null) {
      const t = match[1].trim();
      if (t) {
        shapes.push({ type: "text", text: t });
        text += t + " ";
      }
    }

    // Also extract from a:p (paragraphs) for structure
    const paraRegex = /<a:p[^>]*>([\s\S]*?)<\/a:p>/g;
    while ((match = paraRegex.exec(xml)) !== null) {
      const paraText = match[1].replace(/<[^>]*>/g, "").trim();
      if (paraText) {
        text += paraText + "\n";
      }
    }

    return {
      slideNumber,
      text: text.trim(),
      shapes,
    };
  }

  private extractNotesFromXml(xml: string): string {
    const textRegex = /<a:t[^>]*>([^<]+)<\/a:t>/g;
    let text = "";
    let match;
    while ((match = textRegex.exec(xml)) !== null) {
      text += match[1] + " ";
    }
    return text.trim();
  }
}

export async function extractPptxText(buffer: Buffer): Promise<ExtractResult> {
  const extractor = new PptxExtractor();
  return extractor.extract(buffer);
}
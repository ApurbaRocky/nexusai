/**
 * OCR Provider Abstraction (Phase 3)
 * Supports Tesseract.js locally, with interfaces for cloud providers.
 */
import { createWorker, PSM, OEM, type RecognizeResult, type Page, type RecognizeOptions } from "tesseract.js";
import type { OcrProviderKind, OcrLanguage, OcrResult, OcrWord, DocumentMimeType } from "@/documents/types";
import { sanitizeExtractedText } from "@/documents/security/validation";

export interface OcrProvider {
  readonly kind: OcrProviderKind;
  readonly supportedLanguages: OcrLanguage[];
  initialize(): Promise<void>;
  extractText(buffer: Buffer, options: { mime: DocumentMimeType; language?: OcrLanguage; pageNumber?: number }): Promise<OcrResult>;
  extractPage(buffer: Buffer, pageNumber: number, language?: OcrLanguage): Promise<OcrResult>;
  detectLanguage(buffer: Buffer): Promise<OcrLanguage>;
  terminate(): Promise<void>;
}

interface TesseractWorker {
  recognize: (image: Buffer | string, options?: Partial<RecognizeOptions>) => Promise<RecognizeResult>;
  setParameters(params: Record<string, string | number>): Promise<void>;
  terminate(): Promise<void>;
}

function extractWordsFromPage(page: Page): OcrWord[] {
  const words: OcrWord[] = [];
  if (page.blocks) {
    for (const block of page.blocks) {
      if (block.paragraphs) {
        for (const paragraph of block.paragraphs) {
          if (paragraph.lines) {
            for (const line of paragraph.lines) {
              if (line.words) {
                for (const word of line.words) {
                  words.push({
                    text: word.text,
                    confidence: word.confidence / 100,
                    bbox: {
                      x: word.bbox.x0,
                      y: word.bbox.y0,
                      width: word.bbox.x1 - word.bbox.x0,
                      height: word.bbox.y1 - word.bbox.y0,
                    },
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  return words;
}

export class TesseractOcrProvider implements OcrProvider {
  readonly kind = "tesseract" as const;
  readonly supportedLanguages: OcrLanguage[] = ["eng", "ben", "eng+ben", "auto"];

  private worker: TesseractWorker | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.worker = (await createWorker("eng+ben", 1, {
        logger: m => {
          if (m.status === "recognizing text") {
            console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        },
      })) as unknown as TesseractWorker;

      // Configure for better accuracy
      await this.worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO_OSD,
        tessedit_ocr_engine_mode: OEM.LSTM_ONLY,
        preserve_interword_spaces: "1",
      });

      this.initialized = true;
    } catch (err) {
      throw new Error(`Tesseract initialization failed: ${(err as Error).message}`);
    }
  }

  async extractText(buffer: Buffer, options: { mime: DocumentMimeType; language?: OcrLanguage; pageNumber?: number }): Promise<OcrResult> {
    const worker = this.worker ?? (await this.initialize(), this.worker);
    if (!worker) throw new Error("Tesseract worker unavailable");

    try {
      const result = await worker.recognize(buffer, { rectangle: undefined });
      const data = result.data;

      return {
        text: sanitizeExtractedText(data.text),
        confidence: data.confidence / 100,
        language: data.text.includes("বাংলা") || data.text.includes("অ") ? "ben" : "eng",
        pageNumber: options.pageNumber,
        words: extractWordsFromPage(data),
      };
    } catch (err) {
      throw new Error(`OCR extraction failed: ${(err as Error).message}`);
    }
  }

  async extractPage(buffer: Buffer, pageNumber: number, language?: OcrLanguage): Promise<OcrResult> {
    return this.extractText(buffer, { mime: "image/png", language, pageNumber });
  }

  async detectLanguage(buffer: Buffer): Promise<OcrLanguage> {
    const worker = this.worker ?? (await this.initialize(), this.worker);
    if (!worker) return "eng+ben";

    try {
      // Run quick OCR with both languages to detect
      const result = await worker.recognize(buffer, { rectangle: undefined });
      const data = result.data;
      const text = data.text;

      // Simple heuristic: check for Bengali characters
      const bengaliChars = text.match(/[\u0980-\u09FF]/g)?.length ?? 0;
      const englishChars = text.match(/[a-zA-Z]/g)?.length ?? 0;

      if (bengaliChars > englishChars) return "ben";
      if (englishChars > bengaliChars) return "eng";
      return "eng+ben";
    } catch {
      return "eng+ben";
    }
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
  }
}

// Cloud OCR provider interface (stub for future integration)
export class CloudVisionOcrProvider implements OcrProvider {
  readonly kind = "cloud-vision" as const;
  readonly supportedLanguages: OcrLanguage[] = ["eng", "ben", "eng+ben", "auto"];

  async initialize(): Promise<void> {
    // Initialize Google Cloud Vision client
  }

  async extractText(): Promise<OcrResult> {
    throw new Error("Cloud Vision OCR not implemented yet. Configure GOOGLE_CLOUD_VISION_KEY.");
  }

  async extractPage(): Promise<OcrResult> {
    throw new Error("Cloud Vision OCR not implemented yet.");
  }

  async detectLanguage(): Promise<OcrLanguage> {
    return "auto";
  }

  async terminate(): Promise<void> {
    // Cleanup
  }
}

// Azure OCR provider interface (stub)
export class AzureOcrProvider implements OcrProvider {
  readonly kind = "azure-ocr" as const;
  readonly supportedLanguages: OcrLanguage[] = ["eng", "ben", "eng+ben", "auto"];

  async initialize(): Promise<void> {}

  async extractText(): Promise<OcrResult> {
    throw new Error("Azure OCR not implemented yet. Configure AZURE_OCR_KEY.");
  }

  async extractPage(): Promise<OcrResult> {
    throw new Error("Azure OCR not implemented yet.");
  }

  async detectLanguage(): Promise<OcrLanguage> {
    return "auto";
  }

  async terminate(): Promise<void> {}
}

// No-op provider for when OCR is disabled
export class NoOcrProvider implements OcrProvider {
  readonly kind = "none" as const;
  readonly supportedLanguages: OcrLanguage[] = [];

  async initialize(): Promise<void> {}

  async extractText(): Promise<OcrResult> {
    throw new Error("OCR is disabled. Set ENABLE_OCR=true and configure an OCR provider.");
  }

  async extractPage(): Promise<OcrResult> {
    throw new Error("OCR is disabled.");
  }

  async detectLanguage(): Promise<OcrLanguage> {
    return "auto";
  }

  async terminate(): Promise<void> {}
}

let ocrProviderInstance: OcrProvider | null = null;

export function getOcrProvider(kind?: OcrProviderKind): OcrProvider {
  if (ocrProviderInstance) return ocrProviderInstance;

  const providerKind = kind ?? (process.env.OCR_PROVIDER as OcrProviderKind) ?? "tesseract";

  switch (providerKind) {
    case "tesseract":
      ocrProviderInstance = new TesseractOcrProvider();
      break;
    case "cloud-vision":
      ocrProviderInstance = new CloudVisionOcrProvider();
      break;
    case "azure-ocr":
      ocrProviderInstance = new AzureOcrProvider();
      break;
    case "none":
    default:
      ocrProviderInstance = new NoOcrProvider();
      break;
  }

  return ocrProviderInstance;
}

export async function initializeOcr(): Promise<void> {
  const provider = getOcrProvider();
  await provider.initialize();
}

export async function extractTextFromImage(
  buffer: Buffer,
  options: { language?: OcrLanguage; pageNumber?: number } = {}
): Promise<OcrResult> {
  const provider = getOcrProvider();
  return provider.extractText(buffer, { mime: "image/png", ...options });
}
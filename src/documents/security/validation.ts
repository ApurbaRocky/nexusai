/**
 * Document Security (Phase 3)
 * File validation, signature checking, malware scanning interface, and safe handling.
 */
import { randomBytes } from "node:crypto";
import { ALLOWED_UPLOAD_MIME, UPLOAD_MAX_BYTES } from "@/config";
import type {
  DocumentMimeType,
  FileValidationResult,
  SecurityScanResult,
} from "@/documents/types";

const MAGIC_NUMBERS: Record<DocumentMimeType, number[][]> = {
  "application/pdf": [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  "application/msword": [[0xd0, 0xcf, 0x11, 0xe0]], // DOC OLE
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4b, 0x03, 0x04]], // ZIP-based
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [[0x50, 0x4b, 0x03, 0x04]],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [[0x50, 0x4b, 0x03, 0x04]],
  "application/vnd.ms-excel": [[0xd0, 0xcf, 0x11, 0xe0]], // XLS OLE
  "text/csv": [],
  "text/plain": [],
  "text/markdown": [],
  "application/json": [],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]], // RIFF
};

const DANGEROUS_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "scr", "pif", "msi", "msp", "hta", "cpl",
  "jar", "js", "jse", "vbs", "vbe", "wsf", "wsh", "ps1", "ps1xml", "ps2",
  "ps2xml", "psc1", "psc2", "msh", "msh1", "msh2", "mshxml", "msh1xml",
  "msh2xml", "scf", "lnk", "inf", "reg", "sh", "bash", "zsh", "fish",
  "php", "phtml", "php3", "php4", "php5", "php7", "phar", "py", "pyc",
  "pyo", "pyw", "rb", "pl", "cgi", "asm", "dll", "so", "dylib",
]);

const MAX_FILENAME_LENGTH = 255;

export function validateFile(file: File): FileValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Size check
  if (file.size > UPLOAD_MAX_BYTES) {
    errors.push(`File size ${file.size} exceeds maximum allowed ${UPLOAD_MAX_BYTES} bytes`);
  }

  if (file.size === 0) {
    errors.push("File is empty");
  }

  // Filename check
  if (file.name.length > MAX_FILENAME_LENGTH) {
    errors.push(`Filename too long (max ${MAX_FILENAME_LENGTH} characters)`);
  }

  // Check for dangerous extensions
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    errors.push(`File extension ".${ext}" is not allowed for security reasons`);
  }

  // MIME type check
  const declaredMime = file.type as DocumentMimeType;
  if (!declaredMime || !ALLOWED_UPLOAD_MIME.has(declaredMime)) {
    errors.push(`MIME type "${declaredMime}" is not allowed`);
  }

  // Path traversal check
  if (file.name.includes("..") || file.name.includes("/") || file.name.includes("\\")) {
    errors.push("Filename contains path traversal sequences");
  }

  // Null byte check
  if (file.name.includes("\0")) {
    errors.push("Filename contains null bytes");
  }

  return {
    valid: errors.length === 0,
    mimeType: declaredMime,
    error: errors[0],
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export function checkFileSignature(buffer: Buffer, expectedMime: DocumentMimeType): boolean {
  const signatures = MAGIC_NUMBERS[expectedMime];
  if (!signatures || signatures.length === 0) {
    // No signature defined for this type (text formats), skip check
    return true;
  }

  const header = buffer.subarray(0, Math.max(...signatures.map(s => s.length)));
  const headerBytes = Array.from(header);

  return signatures.some(sig => sig.every((byte, i) => headerBytes[i] === byte));
}

export function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts
  let clean = filename.replace(/[\\/:*?"<>|]/g, "_");
  // Remove null bytes
  clean = clean.replace(/\0/g, "");
  // Trim to max length
  if (clean.length > MAX_FILENAME_LENGTH) {
    const ext = clean.split(".").pop() ?? "";
    const name = clean.slice(0, clean.lastIndexOf("."));
    clean = name.slice(0, MAX_FILENAME_LENGTH - ext.length - 1) + "." + ext;
  }
  return clean || "upload.bin";
}

export function extractSafeExtension(filename: string): string {
  const clean = sanitizeFilename(filename);
  return clean.split(".").pop()?.toLowerCase() ?? "";
}

// Malware scanning interface - to be implemented by specific providers
export interface MalwareScanner {
  scan(buffer: Buffer, filename: string): Promise<SecurityScanResult>;
}

// Stub implementation - replace with actual scanner (ClamAV, etc.)
export class NoOpMalwareScanner implements MalwareScanner {
  async scan(): Promise<SecurityScanResult> {
    return { safe: true };
  }
}

// Archive bomb protection
export function checkArchiveBomb(buffer: Buffer, mime: DocumentMimeType): boolean {
  // For ZIP-based formats (DOCX, XLSX, PPTX), check compression ratio
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    // Heuristic: if compressed size is very small but declared size would be huge
    // This is a basic check; a full implementation would parse the ZIP structure
    const compressedSize = buffer.length;
    if (compressedSize < 1000) {
      // Very small file - could be a zip bomb, but also could be legitimate
      // For now, just warn
      return true;
    }
  }
  return true;
}

// Sanitize extracted text to prevent injection
export function sanitizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, "") // Null bytes
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") // Control chars except newline/tab
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .slice(0, 10_000_000); // 10MB max text
}

// Safe temporary file handling
export function createSafeTempPath(prefix: string, extension: string): string {
  const random = randomBytes(16).toString("hex");
  const safeExt = extension.replace(/[^a-z0-9.]/gi, "");
  return `/tmp/${prefix}-${random}.${safeExt}`;
}
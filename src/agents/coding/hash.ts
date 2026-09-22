/** Content hashing + safe size capping for indexed files. */
import { createHash } from "node:crypto";

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function hashBytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function countLines(content: string): number {
  if (!content) return 0;
  let n = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) n++;
  }
  return content.endsWith("\n") ? n : n + 1;
}

/** Truncate file content stored for search/RAG to stay within sane DB limits. */
export function capContent(content: string, maxChars = 60_000): string {
  return content.length > maxChars ? content.slice(0, maxChars) + "\n… [truncated]" : content;
}

/** Generous but bounded: workplace ops may be fit 100 megs of output. */
export const MAX_RENDER_BYTES = 100 * 1024 * 1024;

export function base64EncodeUtf8(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

export function base64DecodeUtf8(s: string): string {
  return Buffer.from(s, "base64").toString("utf8");
}
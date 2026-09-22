/**
 * Text chunking for the RAG pipeline. Sliding window with token heuristic.
 */
export interface ChunkerOptions {
  chunkSize?: number; // target characters
  overlap?: number; // characters
}

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_OVERLAP = 200;

export function estimateTokens(text: string): number {
  // ~4 chars per token is a common heuristic for English + code.
  return Math.max(1, Math.round(text.length / 4));
}

export function chunkText(text: string, options: ChunkerOptions = {}): { content: string; index: number; tokenCount: number }[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const cleaned = text.replace(/\s{3,}/g, "\n\n");

  const chunks: { content: string; index: number; tokenCount: number }[] = [];
  let start = 0;
  let index = 0;
  const length = cleaned.length;

  while (start < length) {
    let end = Math.min(start + chunkSize, length);
    // Prefer a sentence/paragraph boundary just before `end`, but only when the
    // segment fills the whole window — a short remainder stays a single chunk.
    if (end < length) {
      const alt = findBreakBefore(cleaned, end, start);
      if (alt > start) end = alt;
    }

    const slice = cleaned.slice(start, end).trim();
    if (!slice) {
      start = end + 1;
      continue;
    }
    // If the tail is tiny, attach it to the previous chunk instead.
    if (length - end < 100 && chunks.length && index > 0) {
      const last = chunks[index - 1];
      chunks[index - 1] = { ...last, content: last.content + "\n" + slice, tokenCount: estimateTokens(last.content + slice) };
      break;
    }
    chunks.push({ content: slice, index, tokenCount: estimateTokens(slice) });
    index++;

    // Reached the end of the text: done.
    if (end >= length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function findBreakBefore(text: string, end: number, min: number): number {
  const window = text.slice(Math.max(min, end - 400), end);
  const candidates = ["\n\n", "\n", ". ", "। ", "。 "];
  for (const cand of candidates) {
    const idx = window.lastIndexOf(cand);
    if (idx >= 0) return Math.max(min, end - 400) + idx + cand.length;
  }
  return -1;
}
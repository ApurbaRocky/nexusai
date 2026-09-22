/**
 * Diff engine — LCS-based line diff, unified diff text/HTML preview, and
 * patch application. Chosen over external diff libs to keep the approval
 * surface fully self-contained and auditable.
 */
import type { DiffOp } from "@/agents/coding/types";

export interface DiffSummary {
  additions: number;
  deletions: number;
}

/** Two-row LCS length table for small files; degrees of freedom avoided for large inputs. */
function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

export function lineDiff(oldContent: string, newContent: string, maxLines = 4000): DiffOp[] {
  const a = oldContent.split("\n");
  const b = newContent.split("\n");
  if (a.length > maxLines || b.length > maxLines) {
    // Fall back to full-replace preview for very large files.
    return [
      ...a.map((t, i) => ({ type: "del" as const, oldLine: i + 1, text: t })),
      ...b.map((t, i) => ({ type: "add" as const, newLine: i + 1, text: t })),
    ];
  }

  const dp = lcsTable(a, b);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ type: "context", oldLine: i + 1, newLine: j + 1, text: a[i] });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ type: "add", newLine: j + 1, text: b[j] });
      j++;
    } else if (i < a.length) {
      ops.push({ type: "del", oldLine: i + 1, text: a[i] });
      i++;
    }
  }
  return ops;
}

export function diffSummary(ops: DiffOp[]): DiffSummary {
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === "add") additions++;
    else if (op.type === "del") deletions++;
  }
  return { additions, deletions };
}

/** Compact unified diff text (context window = 300 lines max). */
export function renderUnifiedDiff(oldContent: string, newContent: string, opts: { context?: number; maxLines?: number } = {}): string {
  const context = Math.max(0, opts.context ?? 3);
  const ops = lineDiff(oldContent, newContent, opts.maxLines ?? 4000);
  const out: string[] = [];
  let pending = 0;
  let contextSinceChange = Infinity;
  for (const op of ops) {
    if (op.type === "context") {
      if (contextSinceChange < context) {
        out.push(` ${op.text}`);
        contextSinceChange++;
      } else if (out.length && pending > 0) {
        // compression marker
        out.push("…");
      }
      pending = 0;
    } else if (op.type === "add") {
      out.push(`+${op.text}`);
      contextSinceChange = 0;
      pending++;
    } else {
      out.push(`-${op.text}`);
      contextSinceChange = 0;
      pending++;
    }
  }
  return out.join("\n");
}

/** HTML diff preview (used by the approval UI). Escapes output. */
export function renderHtmlDiff(oldContent: string, newContent: string): string {
  const ops = lineDiff(oldContent, newContent);
  let html = '<div class="overflow-x-auto font-mono text-xs leading-5">';
  for (const op of ops) {
    const text = esc(op.text);
    const lineNo = op.type === "add" ? `L${op.newLine}` : op.type === "del" ? `L${op.oldLine}` : "";
    const cls = op.type === "add" ? "bg-emerald-500/10 text-emerald-300" : op.type === "del" ? "bg-rose-500/10 text-rose-300" : "text-muted-foreground";
    html += `<div class="flex gap-3 whitespace-pre px-2 ${cls}"><span class="w-10 shrink-0 select-none opacity-50">${lineNo}</span><span>${text || " "}</span></div>`;
  }
  return html + "</div>";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Apply an edit to old content given old/new. Returns a mutually verified
 * result so a stale baseline (already-edited file) is detected and rejected.
 */
export function applyEdit(oldContent: string, change: { oldContent?: string; newContent?: string }, baseHash?: string, currentHash?: string): { ok: true; content: string } | { ok: false; error: string } {
  if (baseHash && currentHash && baseHash !== currentHash) {
    return { ok: false, error: "File changed since the change was proposed (hash mismatch). Re-propose against the current content." };
  }
  if (change.newContent === undefined) return { ok: false, error: "No new content provided." };
  if (change.oldContent !== undefined && change.oldContent !== oldContent) {
    return { ok: false, error: "Proposed baseline does not match the current file content." };
  }
  return { ok: true, content: change.newContent };
}
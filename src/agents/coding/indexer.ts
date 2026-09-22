/**
 * RepositoryIndexer â€” scans an on-disk workspace, builds the codebase graph
 * (files, symbols, imports/dependencies, stats) and indexes file content into
 * the shared RAG vector store for semantic code search.
 *
 * Indexing is fully deterministic (no AI calls) so re-indexing is cheap.
 */
import { prisma } from "@/database/client";
import { walkWorkspace, readText, workspaceRoot } from "@/agents/coding/workspace";
import { detectLanguage, classifyFile } from "@/agents/coding/paths";
import { sha256, countLines, capContent } from "@/agents/coding/hash";
import type { CodeSymbolRef, CodeDependencyRef, CodeFileMeta } from "@/agents/coding/types";
import { getVectorStore } from "@/rag/vector-store";
import { getEmbeddingProvider } from "@/rag/embeddings";
import * as fs from "node:fs/promises";
import path from "node:path";

export interface IndexSummary {
  files: number;
  symbols: number;
  dependencies: number;
  lines: number;
  languages: Record<string, number>;
  skippedBinary: number;
  indexedToRag: number;
  durationMs: number;
}

const MAX_FILES_TO_INDEX = 400;
const MAX_FILE_CHARS = 60_000;

export async function indexWorkspace(workspaceId: string, userId: string): Promise<IndexSummary> {
  const t0 = Date.now();
  const ws = await prisma.codingWorkspace.findUnique({ where: { id: workspaceId } });
  if (!ws || ws.userId !== userId) throw new Error("Workspace not found.");

  await prisma.codingWorkspace.update({ where: { id: workspaceId }, data: { status: "indexing", indexError: null } });

  try {
    const ignoreDirs = parseIgnoreList(ws.ignorePatterns);
    const files = await walkWorkspace(workspaceId, { ignoreDirs });
    let skippedBinary = 0;

    const existing = await prisma.codebaseFile.findMany({
      where: { workspaceId },
      select: { id: true, path: true },
    });
    const existingByPath = new Map(existing.map((e) => [e.path, e.id]));

    const upserts: { meta: CodeFileMeta; content: string; symbols: CodeSymbolRef[]; deps: CodeDependencyRef[] }[] = [];
    for (const rel of files.slice(0, MAX_FILES_TO_INDEX)) {
      const r = await readText(workspaceId, rel);
      const buf = await fs.readFile(path.join(workspaceRoot(workspaceId), rel.split("/").join(path.sep))).catch(() => null);
      if (!r.ok || buf === null) {
        skippedBinary++;
        continue;
      }
      if (!isLikelyText(buf)) {
        skippedBinary++;
        continue;
      }
      const content = r.content;
      const meta: CodeFileMeta = {
        path: rel,
        language: detectLanguage(rel),
        sizeBytes: buf.length,
        hash: sha256(content),
        lineCount: countLines(content),
        ...classifyFile(rel),
      };
      const symbols = extractSymbols(content, rel);
      const deps = extractDependencies(content, rel);
      upserts.push({ meta, content, symbols, deps });
    }

    // Reset rows for this workspace (files/symbols/deps are derived state).
    await prisma.$transaction([
      prisma.codeSymbol.deleteMany({ where: { workspaceId } }),
      prisma.codeDependency.deleteMany({ where: { workspaceId } }),
      prisma.codebaseFile.deleteMany({ where: { workspaceId } }),
    ]);

    const totalLines = upserts.reduce((acc, u) => acc + u.meta.lineCount, 0);
    const languages: Record<string, number> = {};
    for (const u of upserts) languages[u.meta.language] = (languages[u.meta.language] ?? 0) + 1;

    const dirs: Record<string, number> = {};
    for (const u of upserts) {
      const dir = path.posix.dirname(u.meta.path);
      dirs[dir === "." ? "/" : dir] = (dirs[dir === "." ? "/" : dir] ?? 0) + 1;
    }

    // Persist files + symbols + deps in one txn.
    await prisma.$transaction(async (tx) => {
      for (const u of upserts) {
        const file = await tx.codebaseFile.create({
          data: {
            workspaceId,
            path: u.meta.path,
            language: u.meta.language,
            sizeBytes: u.meta.sizeBytes,
            hash: u.meta.hash,
            lineCount: u.meta.lineCount,
            isTest: u.meta.isTest,
            isConfig: u.meta.isConfig,
            isDoc: u.meta.isDoc,
            content: capContent(u.content, MAX_FILE_CHARS),
            symbolIndex: u.symbols.length ? JSON.stringify(u.symbols) : null,
            imports: u.deps.length ? JSON.stringify(u.deps) : null,
          },
        });
        if (u.symbols.length) {
          await tx.codeSymbol.createMany({
            data: u.symbols.slice(0, 200).map((s) => ({
              workspaceId,
              fileId: file.id,
              name: s.name,
              kind: s.kind,
              lineStart: s.lineStart,
              lineEnd: s.lineEnd ?? null,
              signature: s.signature ? s.signature.slice(0, 500) : null,
              language: u.meta.language,
              access: s.access ?? null,
            })),
            
          });
        }
        if (u.deps.length) {
          await tx.codeDependency.createMany({
            data: u.deps.slice(0, 120).map((d) => ({
              workspaceId,
              fileId: file.id,
              sourcePath: u.meta.path,
              target: d.target.slice(0, 500),
              isLocal: d.isLocal,
              type: d.type,
              line: d.line ?? null,
            })),
            
          });
        }
      }
    });

    // RAG indexing: one Document row per code file, chunked + embedded.
    let indexedToRag = 0;
    try {
      const store = getVectorStore();
      const embedder = await getEmbeddingProvider();
      const docRows = await prisma.document.findMany({
        where: { userId, meta: { contains: `"codingWorkspaceId":"${workspaceId}"` } },
        select: { id: true, filename: true },
      });
      const ragDocByPath = new Map(docRows.map((d) => [d.filename, d.id]));

      // Remove stale rag docs for files no longer indexed.
      const keepSet = new Set(upserts.map((u) => u.meta.path));
      for (const d of docRows) {
        if (!keepSet.has(d.filename)) {
          await store.deleteByDocument(d.id);
          await prisma.document.delete({ where: { id: d.id } }).catch(() => {});
          ragDocByPath.delete(d.filename);
        }
      }

      for (const u of upserts) {
        let docId = ragDocByPath.get(u.meta.path);
        if (!docId) {
          const doc = await prisma.document.create({
            data: {
              userId,
              filename: u.meta.path,
              originalFilename: u.meta.path.split("/").pop() ?? u.meta.path,
              mimeType: "text/x-code",
              sizeBytes: u.meta.sizeBytes,
              status: "ready",
              sourceType: "code",
              language: u.meta.language,
              meta: JSON.stringify({ codingWorkspaceId: workspaceId, kind: "code" }),
            },
          });
          docId = doc.id;
          ragDocByPath.set(u.meta.path, docId);
        }
        const chunks = chunkCode(u.content);
        const vectors = await embedder.embed(chunks.map((c) => c.text));
        let i = 0;
        for (const c of chunks) {
          await store.upsert({ id: `${docId}:${c.index}`, documentId: docId, index: c.index, content: c.text, metadata: { documentId: docId, timestamp: Date.now() } }, vectors[i] ?? vectors[0] ?? localFallback(c.text));
          i++;
        }
        // Trim chunks beyond what we wrote.
        const written = chunks.length;
        const extra = await prisma.documentChunk.findMany({
          where: { documentId: docId, index: { gte: written } },
          select: { id: true },
        });
        if (extra.length) {
          await prisma.documentChunk.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
        }
        await prisma.document.update({ where: { id: docId }, data: { chunkCount: written, language: u.meta.language } });
        indexedToRag++;
      }
      void existingByPath;
    } catch (err) {
      console.error("[coding:indexer] RAG indexing skipped:", err);
    }

    const entryPoints = detectEntryPoints(files as string[]);
    const stats = {
      fileCount: upserts.length,
      lineCount: totalLines,
      languages,
      directories: dirs,
      entryPoints,
      ignoredFiles: files.length - upserts.length,
    };

    await prisma.codingWorkspace.update({
      where: { id: workspaceId },
      data: {
        status: "ready",
        lastIndexedAt: new Date(),
        stats: JSON.stringify(stats),
        language: dominantLanguage(languages),
        entryPoints: JSON.stringify(entryPoints),
        framework: detectFramework(files as string[], languages),
      },
    });

    return {
      files: upserts.length,
      symbols: upserts.reduce((a, u) => a + u.symbols.length, 0),
      dependencies: upserts.reduce((a, u) => a + u.deps.length, 0),
      lines: totalLines,
      languages,
      skippedBinary,
      indexedToRag,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.codingWorkspace.update({ where: { id: workspaceId }, data: { status: "error", indexError: msg.slice(0, 500) } });
    throw err;
  }
}

function parseIgnoreList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

function isLikelyText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  let nul = 0;
  for (const b of sample) if (b === 0) nul++;
  return nul === 0 && !(sample.length >= 4 && sample[0] === 0x7f && sample[1] === 0x45 && sample[2] === 0x4c && sample[3] === 0x46);
}

export function chunkCode(content: string, maxChars = 1200, overlap = 160): { index: number; text: string; startLine: number }[] {
  if (!content.trim()) return [];
  const lines = content.split("\n");
  const chunks: { start: number; text: string }[] = [];
  let buf: string[] = [];
  let len = 0;
  let startLine = 1;
  let lineNum = 1;
  for (const line of lines) {
    if (!buf.length) startLine = lineNum;
    buf.push(line);
    len += line.length + 1;
    lineNum++;
    if (len >= maxChars) {
      chunks.push({ start: startLine, text: buf.join("\n") });
      buf = buf.slice(-Math.max(1, Math.floor(overlap / 80)));
      len = buf.reduce((a, l) => a + l.length + 1, 0);
      startLine = lineNum - buf.length;
    }
  }
  if (buf.length) chunks.push({ start: startLine, text: buf.join("\n") });
  return chunks.map((c, i) => ({ index: i, text: prependLineMarker(c.start, c.text), startLine: c.start }));
}

function prependLineMarker(startLine: number, text: string): string {
  return `// line:${startLine}\n${text}`;
}

function localFallback(text: string): number[] {
  // Deterministic local embedding used only if embedder returned nothing.
  const vec = new Array<number>(256).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 2000);
  for (const tok of tokens) {
    let seed = 0;
    for (let i = 0; i < tok.length; i++) seed = ((seed << 5) - seed + tok.charCodeAt(i)) | 0;
    const h = Math.abs(seed + 0x9e3779b9);
    vec[h % 256] += (h >> 30) & 1 ? 1 : 0;
  }
  const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Best-effort symbol extraction (regex, no parser). Scales to any language. */
export function extractSymbols(content: string, rel: string): CodeSymbolRef[] {
  const out: CodeSymbolRef[] = [];
  const add = (kind: string, name: string, lineStart: number, sig?: string, access?: string) => {
    if (!name || /[\s{}()]/.test(name)) return;
    out.push({ name, kind, lineStart, signature: sig ?? undefined, access });
  };

  const lines = content.split("\n");
  const lang = detectLanguage(rel);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (lang === "python") {
      let m = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(.*\)\s*:/.exec(trimmed);
      if (m) add("function", m[1], i + 1, trimmed.slice(0, 200));
      m = /^\s*class\s+([A-Za-z_]\w*)/.exec(trimmed);
      if (m) add("class", m[1], i + 1);
      continue;
    }

    if (/^(typescript|javascript|go|csharp|java|rust|kotlin|php|swift)$/.test(lang)) {
      let m = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
      if (m) {
        add("function", m[1], i + 1, trimmed.slice(0, 200), /^export/.test(trimmed) ? "export" : undefined);
      }
      m = /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
      if (m) {
        add("class", m[1], i + 1, trimmed.slice(0, 200), /^export/.test(trimmed) ? "export" : undefined);
        continue;
      }
      m = /\b(?:interface|type)\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
      if (m) {
        add("type", m[1], i + 1);
      }
      m = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(trimmed);
      if (m) {
        add("const", m[1], i + 1, trimmed.slice(0, 200), /^export/.test(trimmed) ? "export" : undefined);
      }
      m = /\b(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:=>|\{)/.exec(trimmed);
      if (m && (trimmed.startsWith("export") || trimmed.includes("function") || trimmed.includes(" => "))) {
        add("function", m[1], i + 1);
      }
      if (/\b(use(?:State|Effect|Memo|Callback|Ref|Query|Mutation|Router|nullspace))\s*\(/.test(trimmed)) {
        add("hook", /(use[A-Z]\w*)/.exec(trimmed)?.[1] ?? "", i + 1);
      }
      continue;
    }

    const m = /^\s*(?:public|private|protected|internal)?\s*(?:static\s+|final\s+|const\s+|let\s+|var\s+|def\s+)?([A-Za-z_]\w*)\s*(?:\(|=|:)\s*/.exec(trimmed);
    if (m && !m[1].match(/^(if|for|while|switch|return|import|export|new|typeof|instanceof)$/)) {
      add("symbol", m[1], i + 1);
    }
  }
  return out;
}

/** Best-effort import/dependency extraction. */
export function extractDependencies(content: string, rel: string): CodeDependencyRef[] {
  const out: CodeDependencyRef[] = [];
  const lang = detectLanguage(rel);
  const lines = content.split("\n");
  const isLocal = (spec: string) => spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/") || spec.startsWith("~");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    let m: RegExpExecArray | null;

    if (lang === "typescript" || lang === "javascript") {
      m = /from\s+['"]([^'"]+)['"]/.exec(trimmed);
      if (m) {
        out.push({ target: m[1], isLocal: isLocal(m[1]), type: "import", line: i + 1 });
        continue;
      }
      m = /import\s*\(\s*['"]([^'"]+)['"]/.exec(trimmed);
      if (m) {
        out.push({ target: m[1], isLocal: isLocal(m[1]), type: "dynamic", line: i + 1 });
        continue;
      }
      m = /require\s*\(\s*['"]([^'"]+)['"]/.exec(trimmed);
      if (m) {
        out.push({ target: m[1], isLocal: isLocal(m[1]), type: "require", line: i + 1 });
      }
      continue;
    }

    if (lang === "python") {
      m = /^\s*(?:from\s+(\S+)\s+import|\s*import\s+(?:from\s+)?(\S+))/.exec(trimmed);
      if (m) {
        const t = m[1] ?? m[2];
        out.push({ target: t, isLocal: t.startsWith("."), type: "import", line: i + 1 });
      }
      continue;
    }

    m = /\b#import\s+[<"']?([^>"']+)/.exec(trimmed); // c/c++/golang
    if (m) {
      out.push({ target: m[1].trim(), isLocal: m[1].startsWith('"'), type: "import", line: i + 1 });
      continue;
    }
    m = /^\s*import\s+([\w.]+)/.exec(trimmed); // java
    if (m) {
      out.push({ target: m[1], isLocal: false, type: "import", line: i + 1 });
    }
  }
  return out;
}

export function detectEntryPoints(files: string[]): string[] {
  const candidates = ["main.py", "main.ts", "main.js", "index.ts", "index.js", "app.ts", "app.js", "src/main.ts", "src/main.tsx", "src/index.ts", "src/index.tsx", "src/app.ts", "server.ts", "server.js", "src/server.ts", "manage.py"];
  const found = files.filter((f) => candidates.includes(f));
  if (files.includes("package.json")) found.push("package.json");
  return found.slice(0, 8);
}

function detectFramework(files: string[], languages: Record<string, number>): string {
  const set = new Set(files);
  if (set.has("package.json")) {
    if (set.has("next.config.js") || set.has("next.config.ts") || set.has("next.config.mjs")) return "Next.js";
    if (set.has("vite.config.ts") || set.has("vite.config.js")) return "Vite";
    if (set.has("nuxt.config.ts")) return "Nuxt";
    if (set.has("angular.json")) return "Angular";
  }
  if (set.has("app.json") || set.has("pubspec.yaml")) return "Flutter/Dart";
  if (languages["python"]) return "Python";
  if (languages["go"]) return "Go";
  if (languages["rust"]) return "Rust";
  return "unknown";
}

function dominantLanguage(languages: Record<string, number>): string | null {
  const entries = Object.entries(languages).filter(([k]) => k !== "unknown" && k !== "lockfile");
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}

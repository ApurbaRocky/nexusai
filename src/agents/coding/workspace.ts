/**
 * On-disk coding workspace management.
 *
 * Workspaces live under <repo>/data/workspaces/<workspaceId>/ so an advisory's
 * view is fully sandboxed to one directory. All read/write goes through
 * resolveWithin(); zip extraction blocks zip-slip and symlink escapes.
 */
import * as fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { normalizeRel, resolveWithin, isIgnoredPath, isDotFile } from "@/agents/coding/paths";
import { hashBytes } from "@/agents/coding/hash";

const DEFAULT_IGNORE_LINES = ["node_modules/*", ".git/*", "dist", "build", ".next", "coverage", ".venv", "__pycache__"];

export function workspaceStorageRoot(): string {
  return path.resolve(process.cwd(), "data", "workspaces");
}

export function workspaceRoot(workspaceId: string): string {
  return path.join(workspaceStorageRoot(), workspaceId);
}

export async function ensureWorkspaceDir(workspaceId: string): Promise<string> {
  const root = workspaceRoot(workspaceId);
  await fs.mkdir(root, { recursive: true });
  return root;
}

export async function removeWorkspaceDir(workspaceId: string): Promise<void> {
  await fs.rm(workspaceRoot(workspaceId), { recursive: true, force: true });
}

/** Resolve a relative path inside the workspace; null if it escapes. */
export function resolveWorkspacePath(workspaceId: string, rel: string): string | null {
  return resolveWithin(workspaceRoot(workspaceId), rel);
}

export async function exists(workspaceId: string, rel: string): Promise<boolean> {
  const target = resolveWorkspacePath(workspaceId, rel);
  if (!target) return false;
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readText(workspaceId: string, rel: string): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const target = resolveWorkspacePath(workspaceId, rel);
  if (!target) return { ok: false, error: `Path "${rel}" is outside the workspace.` };
  try {
    const content = await fs.readFile(target, "utf8");
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type WriteResult = { ok: true } | { ok: false; error: string };

export async function writeText(workspaceId: string, rel: string, content: string): Promise<WriteResult> {
  const target = resolveWorkspacePath(workspaceId, rel);
  if (!target) return { ok: false, error: `Path "${rel}" is outside the workspace.` };
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(target, content, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteFile(workspaceId: string, rel: string): Promise<WriteResult> {
  const target = resolveWorkspacePath(workspaceId, rel);
  if (!target || target === resolveWorkspacePath(workspaceId, ".")) {
    return { ok: false, error: "Refusing to delete the workspace root." };
  }
  try {
    await fs.rm(target, { recursive: false, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function renameFile(workspaceId: string, from: string, to: string): Promise<WriteResult> {
  const src = resolveWorkspacePath(workspaceId, from);
  const dst = resolveWorkspacePath(workspaceId, to);
  if (!src || !dst) return { ok: false, error: "Source or destination is outside the workspace." };
  await fs.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fs.rename(src, dst);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Recursively walk the workspace and list text files (respecting ignores). */
export async function walkWorkspace(workspaceId: string, opts: { ignoreDirs?: string[] } = {}): Promise<string[]> {
  const root = workspaceRoot(workspaceId);
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const rel = path.relative(root, path.join(dir, ent.name)).split(path.sep).join("/");
      if (isIgnoredPath(rel, opts.ignoreDirs) || isDotFile(rel)) continue;
      if (ent.isDirectory()) {
        stack.push(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        out.push(rel);
      }
    }
  }
  return out.sort();
}

/** Snapshot all text files as { path: content } (used for checkpoints/rollback). */
export async function snapshotWorkspace(workspaceId: string): Promise<Record<string, string>> {
  const files = await walkWorkspace(workspaceId);
  const snap: Record<string, string> = {};
  for (const rel of files) {
    const r = await readText(workspaceId, rel);
    if (r.ok) snap[rel] = r.content;
  }
  return snap;
}

/** Restore files from a snapshot (rollback). */
export async function restoreSnapshot(workspaceId: string, snapshot: Record<string, string>): Promise<{ restored: number; failed: string[] }> {
  let restored = 0;
  const failed: string[] = [];
  for (const [rel, content] of Object.entries(snapshot)) {
    const r = await writeText(workspaceId, rel, content);
    if (r.ok) restored++;
    else failed.push(rel);
  }
  return { restored, failed };
}

/**
 * Extract an uploaded ZIP into the workspace with protection against
 * zip-slip (path traversal), symlink escapes and absolute paths.
 */
export async function importZip(workspaceId: string, zipBuffer: Buffer): Promise<{ imported: number; skipped: string[] }> {
  await ensureWorkspaceDir(workspaceId);
  const root = workspaceRoot(workspaceId);
  const zip = await JSZip.loadAsync(zipBuffer);
  let imported = 0;
  const skipped: string[] = [];

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const entry of entries) {
    const rel = normalizeRel(entry.name);
    if (!rel) {
      skipped.push(entry.name);
      continue;
    }
    if (isIgnoredPath(rel) || isDotFile(rel)) {
      skipped.push(rel);
      continue;
    }
    const target = resolveWithin(root, rel);
    if (!target) {
      skipped.push(entry.name);
      continue;
    }
    // symlink guard: never follow links when extracting
    const stat = await fs.lstat(target).catch(() => null);
    if (stat?.isSymbolicLink()) {
      skipped.push(rel);
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    // resolve symlinked parents earlier by re-validating real path
    const realTarget = await pathRealWithin(root, target);
    if (!realTarget) {
      skipped.push(rel);
      continue;
    }
    const content = await entry.async("nodebuffer");
    await fs.writeFile(realTarget, content);
    imported++;
  }
  return { imported, skipped };
}

async function pathRealWithin(root: string, target: string): Promise<string | null> {
  const real = await fs.realpath(path.dirname(target)).catch(() => path.dirname(target));
  const resolved = path.join(real, path.basename(target));
  if (resolved !== path.resolve(root) && !resolved.startsWith(path.resolve(root) + path.sep)) return null;
  return resolved;
}

/** Compute a content hash for a workspace file. */
export async function workspaceFileHash(workspaceId: string, rel: string): Promise<string | null> {
  const target = resolveWorkspacePath(workspaceId, rel);
  if (!target) return null;
  try {
    const buf = await fs.readFile(target);
    return hashBytes(buf);
  } catch {
    return null;
  }
}

/** Return parsed .gitignore lines for the workspace (best-effort). */
export function parseGitignore(content: string): { raw: string[]; effective: string[] } {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .map((l) => l.replace(/\/+$/g, ""));
  return { raw: lines, effective: [...DEFAULT_IGNORE_LINES, ...lines] };
}

/** Very small glob matcher supporting * and ** used by gitignore entry checks. */
export function matchesIgnore(rel: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const escaped = p
      .replace(/\*\*/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, ".*");
    const re = new RegExp(`^${escaped}/?.*$`);
    return re.test(rel);
  });
}
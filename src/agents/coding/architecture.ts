/**
 * ArchitectureAnalyzer — builds the codebase graph from the index: directory
 * layout, language breakdown, entry points, dependency summary and unresolved
 * imports (imports that do not resolve to an indexed file).
 */
import { prisma } from "@/database/client";
import type { ArchitectureReport } from "@/agents/coding/types";
import { relativePosix } from "@/agents/coding/paths";

export async function buildArchitecture(workspaceId: string, userId: string): Promise<ArchitectureReport> {
  const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
  if (!ws) throw new Error("Workspace not found.");

  const [files, symbols, deps] = await Promise.all([
    prisma.codebaseFile.findMany({ where: { workspaceId }, select: { path: true, language: true, lineCount: true } }),
    prisma.codeSymbol.findMany({ where: { workspaceId }, select: { name: true, kind: true } }),
    prisma.codeDependency.findMany({ where: { workspaceId }, select: { sourcePath: true, target: true, isLocal: true } }),
  ]);

  const filePathSet = new Set(files.map((f) => f.path.split("/").join("/")));

  const languages: Record<string, number> = {};
  let lines = 0;
  const directories: Record<string, number> = {};
  for (const f of files) {
    languages[f.language] = (languages[f.language] ?? 0) + 1;
    lines += f.lineCount ?? 0;
    const dir = relativePosix("", f.path).split("/").slice(0, -1);
    const key = "./" + (dir.length ? dir.join("/") : "");
    directories[key] = (directories[key] ?? 0) + 1;
  }

  const depCount = new Map<string, { name: string; count: number; local: boolean }>();
  for (const d of deps) {
    const key = d.target;
    const cur = depCount.get(key) ?? { name: d.target, count: 0, local: d.isLocal };
    cur.count += 1;
    depCount.set(key, cur);
  }

  const unresolvedImports: ArchitectureReport["unresolvedImports"] = [];
  for (const d of deps) {
    if (!d.isLocal) continue;
    const clean = normalizeLocalTarget(d.target, d.sourcePath);
    if (clean && !filePathSet.has(clean)) {
      unresolvedImports.push({ target: clean, from: d.sourcePath });
    }
  }

  let entryPoints = ["/"];
  try {
    const parsed = JSON.parse(ws.entryPoints ?? "[]") as string[];
    if (Array.isArray(parsed) && parsed.length) entryPoints = parsed;
  } catch {
    /* ignore */
  }

  const byKind: Record<string, number> = {};
  for (const s of symbols) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;

  return {
    entryPoints,
    files: files.length,
    lines,
    languages,
    directories,
    topDependencies: [...depCount.values()].sort((a, b) => b.count - a.count).slice(0, 25),
    unresolvedImports: unresolvedImports.slice(0, 50),
  };
}

/** Best-effort: resolve `./x` or `../x` import from importing file to a repo-root relative path. */
function normalizeLocalTarget(target: string, from: string): string | null {
  if (target.startsWith("/") || target.startsWith("@/") || target.startsWith("~/")) {
    return target.replace(/^@?\//, "").replace(/^~/, "");
  }
  if (target.startsWith(".")) {
    const baseDir = from.split("/").slice(0, -1).join("/");
    const resolved = `${baseDir ? baseDir + "/" : ""}${target}`;
    return resolved
      .split("/")
      .reduce<string[]>((acc, seg) => {
        if (seg === "..") acc.pop();
        else if (seg !== ".") acc.push(seg);
        return acc;
      }, [])
      .join("/");
  }
  return null;
}
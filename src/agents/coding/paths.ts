/**
 * Path safety + language/ignore detection for coding workspaces.
 *
 * All workspace file access MUST go through resolveWithin() so an advisory
 * can never escape the workspace root (path traversal protection).
 */
import path from "node:path";

export const DEFAULT_IGNORE_DIRS = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
  ".nyc_output",
  "venv",
  ".venv",
  "__pycache__",
  ".cache",
  ".mypy_cache",
  ".pytest_cache",
  ".eslintcache",
  "target",
  ".idea",
  ".vscode",
  "public",
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|avif|svg|woff\d?|ttf|eot|otf|bin|exe|dll|so|dylib|zip|tar|gz|bz2|7z|jar|class|pyc|pdf|mp[34]|mkv|mpg|avi|mov|ico|db|sqlite|wasm|map)$/i;

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".scala": "scala",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".json": "json",
  ".jsonc": "json",
  ".toml": "toml",
  ".ini": "ini",
  ".cfg": "ini",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".sql": "sql",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".ps1": "powershell",
  ".bat": "batch",
  ".cmd": "batch",
  ".xml": "xml",
  ".prisma": "prisma",
  ".gradle": "gradle",
  ".lock": "lockfile",
  ".env": "dotenv",
  ".proto": "protobuf",
};

const TEST_NAME = /(^|[\/._-])(test|spec)([._-]|$)|(__tests?__)/i;
const CONFIG_NAME = /(^|[\/._-])(config|conf|settings?|env)([._-]|$)|\.(config|conf)\./i;

/** Normalize an advisory-provided relative path; null if unsafe (traversal/absolute). */
export function normalizeRel(rel: string): string | null {
  const norm = String(rel).split("\\").join("/").replace(/^\/+/, "");
  if (!norm || norm === "." || norm === "..") return null;
  const parts = norm.split("/");
  if (parts.some((p) => p === "" || p === "..")) return null;
  if (/^[a-zA-Z]:/.test(norm)) return null; // windows drive absolute
  return norm;
}

export function isIgnoredPath(rel: string, extraIgnoreDirs: string[] = []): boolean {
  const segments = rel.split("/");
  const dirs = [...DEFAULT_IGNORE_DIRS, ...(extraIgnoreDirs ?? []).filter(Boolean)];
  for (const dir of dirs) {
    if (segments.includes(dir)) return true;
  }
  return BINARY_EXT.test(rel);
}

export function isDotFile(rel: string): boolean {
  return rel.split("/").some((seg) => seg.startsWith(".") && seg !== ".gitignore" && seg !== ".env.example");
}

/** Resolve rel inside root. Returns null unless the target is strictly inside root. */
export function resolveWithin(root: string, rel: string): string | null {
  const safe = normalizeRel(rel);
  if (!safe) return null;
  const absRoot = path.resolve(root);
  const target = path.resolve(absRoot, safe);
  if (target !== absRoot && !target.startsWith(absRoot + path.sep)) return null;
  return target;
}

export function detectLanguage(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (LANG_BY_EXT[ext]) return LANG_BY_EXT[ext];
  const base = path.basename(filename);
  if (base === "Dockerfile") return "docker";
  if (base.endsWith(".env")) return "dotenv";
  if (base.startsWith("Makefile")) return "make";
  return "unknown";
}

export function classifyFile(pathname: string): { isTest: boolean; isConfig: boolean; isDoc: boolean } {
  const lower = pathname.toLowerCase();
  return {
    isTest: TEST_NAME.test(pathname),
    isConfig: CONFIG_NAME.test(pathname) || lower.endsWith(".env") || lower.endsWith(".json"),
    isDoc: LANG_BY_EXT[path.extname(pathname).toLowerCase()] === "markdown" || /\.(txt|adoc|rst)$/i.test(pathname),
  };
}

export function isTextFile(pathname: string): boolean {
  if (BINARY_EXT.test(pathname)) return false;
  detectLanguage(pathname);
  return true;
}

export function relativePosix(absRoot: string, file: string): string {
  const rel = path.relative(path.resolve(absRoot), path.resolve(file)).split(path.sep).join("/");
  return rel;
}

export function workspaceRoot(workspaceDir: string): string {
  return path.resolve(workspaceDir);
}
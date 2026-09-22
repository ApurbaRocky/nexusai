/**
 * GitService — workspace git operations (spec §29–§30).
 *
 * Security model: status/diff/log/branch/show are read-only and safe.
 * init/commit require explicit confirmation (`confirmed === true`) AND the
 * calling controller must have already enforced GIT_WRITE permission. The
 * agent NEVER pushes, force-resets, or touches remotes.
 */
import { execFile } from "node:child_process";
import { workspaceRoot } from "@/agents/coding/workspace";

export interface GitRunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface GitStatusEntry {
  status: string;
  path: string;
}

function runGit(workspaceId: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<GitRunResult> {
  const cwd = workspaceRoot(workspaceId);
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: opts.timeoutMs ?? 15_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0;
      if (err && (err as NodeJS.ErrnoException).code === "ETIMEDOUT") {
        resolve({ ok: false, code: null, stdout: "", stderr: "git timed out" });
        return;
      }
      resolve({ ok: code === 0, code: typeof code === "number" ? code : 1, stdout, stderr });
    });
  });
}

const READ_ONLY_ARGS: Array<[string, readonly string[]]> = [
  // [fragment-matching, safe args]
];

/** True if the whole git invocation is read-only. */
function isReadOnly(args: string[]): boolean {
  const a = args.join(" ");
  return /^(status|diff|log|branch|show|rev-parse|config|remote|ls-files|blame|stash\s+list|tag\b|describe)\b/.test(a);
}

export class GitService {
  constructor(private readonly workspaceId: string) {}

  async repoExists(): Promise<boolean> {
    const r = await runGit(this.workspaceId, ["rev-parse", "--is-inside-work-tree"]);
    return r.ok;
  }

  async status(): Promise<GitStatusEntry[]> {
    const r = await runGit(this.workspaceId, ["status", "--porcelain"]);
    if (!r.ok) return [];
    return r.stdout
      .split("\n")
      .filter((l) => l.trim().length >= 3)
      .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) }))
      .slice(0, 200);
  }

  async branch(): Promise<string> {
    const r = await runGit(this.workspaceId, ["branch", "--show-current"]);
    return r.ok ? r.stdout.trim() || "detached" : "none";
  }

  async diff({ staged = false, path: filePath, maxChars = 20_000 }: { staged?: boolean; path?: string; maxChars?: number } = {}): Promise<string> {
    const args = ["diff", ...(staged ? ["--cached"] : []), ...(filePath ? ["--", filePath] : [])];
    const r = await runGit(this.workspaceId, args);
    return r.ok ? cliptext(r.stdout, maxChars) : "";
  }

  async log({ max = 20 }: { max?: number } = {}): Promise<string> {
    const r = await runGit(this.workspaceId, ["log", "--oneline", "-n", String(max), "--decorate=short"]);
    return r.ok ? r.stdout : "";
  }

  async show(ref: string, maxChars = 20_000): Promise<string> {
    const r = await runGit(this.workspaceId, ["show", ref]);
    return r.ok ? cliptext(r.stdout, maxChars) : "";
  }

  async recentFiles(max = 30): Promise<string[]> {
    const r = await runGit(this.workspaceId, ["log", `-n${max}`, "--name-only", "--pretty=format:"]);
    if (!r.ok) return [];
    const seen = new Set<string>();
    for (const line of r.stdout.split("\n")) {
      const p = line.trim();
      if (p && !seen.has(p)) seen.add(p);
    }
    return [...seen].slice(0, max);
  }

  /** Requires confirmed === true at controller level (plus GIT_WRITE). */
  async init(): Promise<GitRunResult> {
    return runGit(this.workspaceId, ["init", "-b", "main"]);
  }

  /** Requires confirmed === true at controller level (plus GIT_WRITE). */
  async commit(message: string, { files }: { files?: string[] } = {}): Promise<GitRunResult> {
    const args = files && files.length ? ["add", ...files] : ["add", "-A"];
    const add = await runGit(this.workspaceId, args);
    if (!add.ok) return add;
    return runGit(this.workspaceId, ["commit", "-m", message]);
  }

  async assertReadOnly(args: string[], reason: string): Promise<GitRunResult> {
    if (!isReadOnly(args)) {
      return { ok: false, code: 3, stdout: "", stderr: `Blocked git operation (${reason}). The agent never pushes or force-writes.` };
    }
    return runGit(this.workspaceId, args);
  }
}

function cliptext(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n… [truncated]" : s;
}

export function isGitReadOnly(args: string[]): boolean {
  return isReadOnly(args);
}

export const GIT_READ_ONLY = READ_ONLY_ARGS;
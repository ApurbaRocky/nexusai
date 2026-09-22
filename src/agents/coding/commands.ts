/**
 * Command sandbox for the coding agent (spec §22–§24).
 *
 * - CommandAllowlist: only known-safe prefixes run at all.
 * - CommandRiskAnalyzer: flags destructive/lateral patterns before execution.
 * - WorkspaceSandbox/CommandRunner: executes inside the workspace cwd with a
 *   timeout and output cap. Never runs with elevated privileges, never
 *   touches paths outside the workspace proved by the caller.
 */
import { exec, type ChildProcess } from "node:child_process";
import { workspaceRoot } from "@/agents/coding/workspace";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const ALLOWED_PREFIXES = [
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "node",
  "python",
  "python3",
  "pip",
  "pip3",
  "py",
  "go",
  "cargo",
  "dotnet",
  "mvn",
  "make",
  "bash",
  "sh",
  "zsh",
  "eslint",
  "prettier",
  "tsc",
  "jest",
  "vitest",
  "next",
  "tsx",
  "json",
  "echo",
  "printf",
  "test",
  "./gradlew",
  "./mvnw",
  "git",
  "deno",
];

/** Never-run fragments regardless of prefix. */
const BLOCKED_PATTERNS = [
  /\brm\s+(-[a-z]*r[a-z]*|-[a-z]*f[a-z]*)?\s+/i,
  /\brmdir\s+/i,
  /\bdel\s+\/s/i,
  /\bformat\s+[a-zA-Z]:/i,
  /\bmkfs\./,
  /\bdd\s+of=/,
  /\bshred\b/,
  /\bdiskpart\b/,
  /\bchmod\s+(-[^ ]* )?[0-7]{3}/,
  /\bchown\b/,
  /\bsudo\b/,
  /\bsystemctl\b/,
  /\bpowercfg\b/,
  /\bgpasswd\b/,
  /\buser(add|mod|del)\b/,
  /\bpasswd\b/,
  /\bcurl\s+.*\|\s*(sh|bash|zsh|python)\b/i,
  /\bwget\s+.*\|\s*(sh|bash|zsh|python)\b/i,
  /\bgpg\b/,
  /\bopenssl\s+enc\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bgit\s+(push|fetch|clone)\b/, // push/fetch/clone handled only via GitService for read sources
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-f/,
  /\bgit\s+branch\s+-D\b/,
  /\b\.\s*\/.*(\.sh|\.bat|\.exe|\.cmd)\s*[\|\&;]/i,
];

/** Risky but sometimes fine — flagged medium/high and require explicit approval. */
const WARNING_PATTERNS: { re: RegExp; risk: RiskLevel; note: string }[] = [
  { re: /\brm\b/i, risk: "high", note: "Removal command." },
  { re: /\bmv\b/i, risk: "medium", note: "Move command (overwrites targets)." },
  { re: />\s*\/dev\/|2>\s*\/dev\//, risk: "high", note: "Discards stream to /dev/null." },
  { re: /\bnpm\s+(install|add|i\b)\b/, risk: "medium", note: "Installs packages (network + disk)." },
  { re: /\bnpx\b/, risk: "medium", note: "May download and execute packages." },
  { re: /\bgit\s+commit\b/, risk: "medium", note: "Creates a commit (requires GIT_WRITE)." },
  { re: /\bgit\s+(checkout|restore|stash)\b/, risk: "medium", note: "May discard uncommitted work." },
];

export interface CommandRisk {
  level: RiskLevel;
  blocked: boolean;
  allowlisted: boolean;
  notes: string[];
}

export function analyzeCommand(command: string): CommandRisk {
  const cmd = command.trim();
  if (!cmd) return { level: "medium", blocked: false, allowlisted: false, notes: ["Empty command."] };

  const first = firstToken(cmd).toLowerCase();
  const allowlisted = ALLOWED_PREFIXES.some((p) => first === p || first.startsWith(p + "/") || (first === "./gradlew" && cmd.startsWith("./gradlew")));

  const notes: string[] = [];
  let level: RiskLevel = allowlisted ? "low" : "medium";

  for (const { re, risk: r, note } of WARNING_PATTERNS) {
    if (re.test(cmd)) {
      notes.push(note);
      if (rank(level) < rank(r)) level = r;
    }
  }

  const blocked = BLOCKED_PATTERNS.some((re) => re.test(cmd));

  if (!allowlisted) {
    notes.push(`Prefix "${first}" is not on the allowlist.`);
    level = "high";
  }
  if (blocked) {
    notes.push("Command matches a blocked pattern.");
    level = "critical";
  }
  return { level, blocked, allowlisted, notes };
}

function rank(r: RiskLevel): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[r];
}

function firstToken(cmd: string): string {
  const m = /^\s*(?:([^\s]+)\s+([^\s]+))/i.exec(cmd); // possible command alias
  return (m?.[1] ?? cmd.split(/\s+/)[0] ?? "").replace(/['"`]/g, "");
}

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
  env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT = 200_000;

/** Execute a command inside the workspace, capturing output with a hard cap. */
export function runCommand(command: string, opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const cwd = opts.cwd ?? process.cwd();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutput = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT;
    const started = Date.now();

    let child: ChildProcess;
    try {
      child = exec(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxOutput,
        windowsHide: true,
        env: {
          NODE_ENV: process.env.NODE_ENV ?? "production",
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          SystemRoot: process.env.SystemRoot,
          ComSpec: process.env.ComSpec,
          LANG: process.env.LANG,
          LC_ALL: process.env.LC_ALL,
          NO_COLOR: "1",
          CI: "1",
          ...(opts.env ?? {}),
        },
      });
    } catch (err) {
      resolve({ ok: false, exitCode: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err), durationMs: 0, timedOut: false });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout?.on("data", (d: Buffer | string) => {
      stdout = appendCapped(stdout, d.toString(), maxOutput);
    });
    child.stderr?.on("data", (d: Buffer | string) => {
      stderr = appendCapped(stderr, d.toString(), maxOutput);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ETIMEDOUT") timedOut = true;
      else stderr = appendCapped(stderr, err.message, maxOutput);
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    });
  });
}

function appendCapped(cur: string, chunk: string, cap: number): string {
  if (cur.length >= cap) return cur;
  const next = cur + chunk;
  return next.length > cap ? next.slice(0, cap) + "\n… [output truncated]" : next;
}

/** Guess a sensible test command for a workspace. */
export async function defaultTestCommand(workspaceId: string): Promise<{ command: string; label: string }> {
  const root = workspaceRoot(workspaceId);
  const { readText } = await import("@/agents/coding/workspace");
  const r = await readText(workspaceId, "package.json");
  if (r.ok) {
    try {
      const pkg = JSON.parse(r.content) as { scripts?: Record<string, string> };
      if (pkg.scripts?.test) return { command: "npm test", label: "npm test" };
      if (pkg.scripts?.["test:unit"]) return { command: "npm run test:unit", label: "npm run test:unit" };
    } catch {
      /* ignore */
    }
  }
  void root;
  try {
    const hasPytest = await import("node:fs/promises").then((fs) => fs.access(`${root}/pytest.ini`).then(() => true).catch(() => false));
    if (hasPytest) return { command: "python -m pytest -q", label: "pytest" };
  } catch {
    /* ignore */
  }
  return { command: "", label: "none" };
}
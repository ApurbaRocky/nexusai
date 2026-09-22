/**
 * Coding engines — the LLM-backed reasoning layer (spec §16, §20, §25–§28).
 *
 * Each engine: gathers deterministic context from the index (search,
 * architecture, file contents), asks the resolved coding model for structured
 * JSON, then falls back to a safe deterministic result when the LLM is
 * unavailable or its output is not parseable (keeps demo mode functional).
 */
import { codingComplete, extractJson } from "@/agents/coding/llm";
import type { ChatMessage } from "@/types";
import type { ChangePlanStep, CodingPlanData, DebugRootCause, ReviewFinding, ArchitectureReport } from "@/agents/coding/types";
import { codeSearch } from "@/agents/coding/code-search";
import { buildArchitecture } from "@/agents/coding/architecture";
import { readText } from "@/agents/coding/workspace";
import { sha256 } from "@/agents/coding/hash";

const PLAN_SCHEMA = `
Return JSON only, matching:
{"summary":"one line","goals":["..."],"steps":[{"title":"...","description":"...","files":["rel/path"],"dependsOn":["step title"],"duration":"minutes"}],"risks":["..."]}`;

const REVIEW_SCHEMA = `
Return JSON only, matching:
{"findings":[{"severity":"critical|high|medium|low","category":"security|bug|style|performance|maintainability","path":"rel/path","line":"1-10 or '1' or ''","title":"...","detail":"...","suggestion":"..."}]}`;

const DEBUG_SCHEMA = `
Return JSON only, matching:
{"summary":"...","symptom":"...","probableRootCause":"...","evidence":["..."],"checkCommands":["..."],"suggestedFile":"./path","suggestedFix":"...","confidence":"high|medium|low"}`;

const REFACTOR_SCHEMA = `
Return JSON only, matching:
{"summary":"...","changes":[{"path":"rel/path","description":"what to change","suggestedContent":"full new file content (or absent for delete)","itemized":["..."]}]}`;

const DOCS_SCHEMA = `
Return JSON only, matching:
{"title":"...","overview":"...","markdown":"## ... full (markdown string escaped with \\n)"}`;

interface EngineCtx {
  workspaceId: string;
  userId: string;
}

function sys(sysTag: string): string {
  return `You are the coding engine (${sysTag}) of AI Nexus. Be concrete, accurate, concise. Report only facts grounded in the provided file context. Never fabricate file paths or line numbers. Never claim changes were made. This is a read/reason output — it does NOT modify files.`;
}

function bot1(): ChatMessage {
  return { role: "user", content: "Begin." };
}

async function archSummary(a: ArchitectureReport): Promise<string> {
  return [
    `Files: ${a.files}, lines: ${a.lines}`,
    `Languages: ${Object.entries(a.languages).map(([k, v]) => `${k}(${v})`).join(", ")}`,
    `Entry points: ${a.entryPoints.join(", ") || "none"}`,
    `Top deps: ${a.topDependencies.slice(0, 8).map((d) => d.name).join(", ") || "none"}`,
    a.unresolvedImports.length ? `Unresolved imports: ${a.unresolvedImports.slice(0, 5).map((i) => i.target).join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// TaskPlanner
// ---------------------------------------------------------------------------

export async function planTask(ctx: EngineCtx, prompt: string): Promise<CodingPlanData> {
  const [arch, search] = await Promise.all([
    buildArchitecture(ctx.workspaceId, ctx.userId),
    codeSearch(ctx.workspaceId, ctx.userId, { query: firstMeaningful(prompt), limit: 6 }).catch(() => []),
  ]);
  const hits = search.filter((h) => h.kind !== "semantic").slice(0, 6);

  const system = sys("task-planner");
  const userMsg = `TASK: ${prompt}\n\nCODEBASE ARCHITECTURE:\n${await archSummary(arch)}\n\nRELEVANT LOCATIONS:\n${hits.map((h) => `${h.path}:${h.line} — ${h.content.slice(0, 120)}`).join("\n") || "none"}\n\n${PLAN_SCHEMA}`;

  try {
    const raw = await codingComplete(ctx.userId, { system, messages: [bot1(), { role: "user", content: userMsg }] });
    const plan = extractJson<CodingPlanData>(raw);
    if (!Array.isArray(plan.steps)) throw new Error("bad plan");
    plan.steps = plan.steps.slice(0, 12).map((s) => ({ title: s.title, description: s.description, files: (s.files ?? []).slice(0, 10) } satisfies ChangePlanStep));
    return plan;
  } catch {
    return {
      summary: `Analyzed request: ${prompt.slice(0, 120)}`,
      goals: ["Understand the request within this codebase", "Provide a concrete, testable implementation plan"],
      steps: [
        { title: "Survey relevant code", description: "Inspect the files matched by the search index for this task.", files: hits.map((h) => h.path).slice(0, 5), dependsOn: [], duration: "2m16s" },
        { title: "Implement change", description: "(Requires the coding model or explicit approval) Apply the proposed edit to the target files.", files: hits.map((h) => h.path).slice(0, 5), dependsOn: ["Survey relevant code"], duration: "8m" },
        { title: "Run tests", description: "Execute the workspace test command to verify the change.", files: [], dependsOn: ["Implement change"], duration: "3m" },
      ],
      risks: [],
    };
  }
}

// ---------------------------------------------------------------------------
// CodeReviewEngine
// ---------------------------------------------------------------------------

export async function reviewFiles(ctx: EngineCtx, paths: string[]): Promise<ReviewFinding[]> {
  const files = await Promise.all(
    paths.slice(0, 5).map(async (p) => {
      const r = await readText(ctx.workspaceId, p);
      return { path: p, ok: r.ok, content: r.ok ? r.content : "" };
    }),
  );
  const included = files.filter((f) => f.ok);
  if (!included.length) return [];

  const system = sys("code-review");
  const userMsg = `REVIEW THESE FILES. Report concrete problems only; skip nitpicks. Include line ranges/security concerns.\n\n${included
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 6000)}\n\`\`\``)
    .join("\n\n")}\n\n${REVIEW_SCHEMA}`;

  try {
    const raw = await codingComplete(ctx.userId, { system, messages: [bot1(), { role: "user", content: userMsg }], temperature: 0.2 });
    const parsed = extractJson<{ findings: ReviewFinding[] }>(raw);
    return (parsed.findings ?? [])
      .filter((f) => f.path && f.title)
      .slice(0, 30)
      .map((f) => ({ severity: f.severity, category: f.category, path: f.path, line: f.line ?? "", title: f.title, detail: f.detail ?? "", suggestion: f.suggestion ?? "" }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// DebuggingEngine
// ---------------------------------------------------------------------------

export async function debugSymptom(ctx: EngineCtx, symptom: string): Promise<DebugRootCause> {
  const arch = await buildArchitecture(ctx.workspaceId, ctx.userId);
  const hits = await codeSearch(ctx.workspaceId, ctx.userId, { query: firstMeaningful(symptom), limit: 6 }).catch(() => []);
  const system = sys("debugger");
  const userMsg = `SYMPTOM: ${symptom}\n\nARCHITECTURE:\n${await archSummary(arch)}\n\nMATCHING LOCATIONS:\n${hits.slice(0, 6).map((h) => `${h.path}:${h.line} — ${h.content.slice(0, 120)}`).join("\n") || "none"}\n\n${DEBUG_SCHEMA}`;

  try {
    const raw = await codingComplete(ctx.userId, { system, messages: [bot1(), { role: "user", content: userMsg }], temperature: 0.2 });
    const d = extractJson<DebugRootCause>(raw);
    if (!d.probableRootCause) throw new Error("bad debug");
    return { ...d, evidence: (d.evidence ?? []).slice(0, 10), checkCommands: (d.checkCommands ?? []).slice(0, 8), suggestedFix: d.suggestedFix ?? "" };
  } catch {
    return {
      summary: `Analysis for: ${symptom.slice(0, 120)}`,
      symptom,
      probableRootCause: "Could not reach a coding model; verified the matching files exist in the index (see evidence).",
      evidence: hits.slice(0, 5).map((h) => `${h.path}:${h.line}`),
      checkCommands: [],
      suggestedFile: hits[0]?.path ?? "",
      suggestedFix: "",
      confidence: "low",
    };
  }
}

// ---------------------------------------------------------------------------
// RefactoringEngine
// ---------------------------------------------------------------------------

export interface RefactorResult {
  summary: string;
  changes: { path: string; description: string; suggestedContent?: string; itemized: string[] }[];
}

export async function refactorContent(ctx: EngineCtx, prompt: string, paths: string[]): Promise<RefactorResult> {
  const files = await Promise.all(
    paths.slice(0, 3).map(async (p) => {
      const r = await readText(ctx.workspaceId, p);
      return { path: p, ok: r.ok, content: r.ok ? r.content : "" };
    }),
  );
  const included = files.filter((f) => f.ok);

  if (included.length === 0) {
    return { summary: "Could not read requested files for refactoring.", changes: [] };
  }

  const system = sys("refactoring-engine");
  const userMsg = `REFACTOR: ${prompt}\n\nFILES (current content):\n${included
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 8000)}\n\`\`\``)
    .join("\n\n")}\n\nRules: preserve behavior. Full-file replacement content goes in "suggestedContent".\n${REFACTOR_SCHEMA}`;

  try {
    const raw = await codingComplete(ctx.userId, { system, messages: [bot1(), { role: "user", content: userMsg }], temperature: 0.2 });
    const r = extractJson<RefactorResult>(raw);
    return {
      summary: r.summary ?? "",
      changes: (r.changes ?? []).slice(0, 5).map((c) => ({ path: c.path, description: c.description ?? "", suggestedContent: c.suggestedContent, itemized: (c.itemized ?? []).slice(0, 8) })),
    };
  } catch {
    return {
      summary: `Deterministic plan for: ${prompt.slice(0, 120)} (coding model unavailable — no content changes proposed).`,
      changes: [],
    };
  }
}

// ---------------------------------------------------------------------------
// DocumentationEngine
// ---------------------------------------------------------------------------

export async function generateDocs(ctx: EngineCtx, prompt: string, paths: string[]): Promise<string> {
  const files = await Promise.all(
    paths.slice(0, 5).map(async (p) => {
      const r = await readText(ctx.workspaceId, p);
      return { path: p, ok: r.ok, content: r.ok ? r.content : "" };
    }),
  );
  const included = files.filter((f) => f.ok);
  if (!included.length) return "No readable files to document.";

  const system = sys("documentation-engine");
  const userMsg = `DOCUMENT THIS: ${prompt}\n\nFILES:\n${included
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 5000)}\n\`\`\``)
    .join("\n\n")}\n\n${DOCS_SCHEMA}`;

  try {
    const raw = await codingComplete(ctx.userId, { system, messages: [bot1(), { role: "user", content: userMsg }] });
    const r = extractJson<{ markdown: string }>(raw);
    return r.markdown?.length ? r.markdown : raw;
  } catch {
    return `# ${paths[0] ?? "code"}\n\n(Documentation engine could not reach a coding model — deterministic summary only.)\n\nFiles: ${included.map((f) => `\`${f.path}\``).join(", ")}`;
  }
}

// ---------------------------------------------------------------------------

export async function analyzeFileDanger(workspaceId: string, path: string): Promise<{ safe: boolean; reason: string }> {
  const r = await readText(workspaceId, path);
  if (!r.ok) return { safe: true, reason: "file missing" };
  const low = r.content.toLowerCase();
  const dangerPatterns: Array<[string, RegExp]> = [
    ["fetch on user-controlled URL", /fetch\(\s*[\w$-]*user/i],
    ["shell injection", /\bexec\(|system\(|child_process\b/i],
    ["eval of remote input", /\beval\(\s*[a-z]+/i],
    ["credential hardcode", /(api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]{8,}['"]/i],
    ["raw SQL concatenation", /\bquery\s*[+=]|select\s+[\w*]+\s+from\s+[^()]+\s*\+/i],
  ];
  const reason = dangerPatterns
    .map(([label, re]) => (re.test(low) ? label : null))
    .filter(Boolean)
    .slice(0, 5)
    .join(", ");
  return { safe: !reason, reason: reason || "no obvious danger patterns" };
}

function firstMeaningful(prompt: string): string {
  const words = prompt.split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
  return words.join(" ") || prompt.slice(0, 20);
}

export function fileHashHex(content: string): string {
  return sha256(content);
}
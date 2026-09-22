/**
 * Coding agent tools (spec §14–§15). Every tool requires codingWorkspaceId in
 * the context. Mutating tools (apply_change, run_command, git_commit) are
 * HIGH/CRITICAL: they check ctx.confirmed and the workspace permission level
 * before touching anything, and every run is recorded.
 */
import { z } from "zod";
import type { ToolDef, ToolContext } from "@/tools/types";
import { CodingAgent } from "@/agents/coding/agent";
import { codeSearch } from "@/agents/coding/code-search";
import { buildArchitecture } from "@/agents/coding/architecture";
import { readText } from "@/agents/coding/workspace";
import { prisma } from "@/database/client";
import { analyzeCommand } from "@/agents/coding/commands";
import { capContent } from "@/agents/coding/hash";

function needWs(ctx: ToolContext): string {
  if (!ctx.codingWorkspaceId) throw new Error("codingWorkspaceId is required in the tool context.");
  return ctx.codingWorkspaceId;
}

function needConfirm(ctx: ToolContext, name: string) {
  if (!ctx.confirmed) throw new Error(`Tool "${name}" requires explicit user confirmation (confirmed=true) — nothing was changed.`);
}

const searchSchema = z.object({
  query: z.string().min(1),
  mode: z.enum(["exact", "word", "symbol", "semantic", "auto"]).optional().default("auto"),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export const codingSearchTool: ToolDef<typeof searchSchema> = {
  name: "coding.search",
  description: "Search the coding workspace source: exact string, whole words, symbols, or semantic similarity. Returns file:line hits.",
  inputSchema: searchSchema,
  riskLevel: "low",
  execute: async (args, ctx) => {
    const ws = needWs(ctx);
    const hits = await codeSearch(ws, ctx.userId, args);
    if (!hits.length) return { content: "No matches.", data: { hits: [] } };
    const content = hits
      .slice(0, 25)
      .map((h) => `${h.path}:${h.line} [${h.kind}] ${h.content.slice(0, 150)}`)
      .join("\n");
    return { content: `Found ${hits.length} matches:\n${content}`, data: { hits } };
  },
};

const readSchema = z.object({
  path: z.string().min(1),
  maxChars: z.number().int().min(200).max(60000).optional().default(12000),
});

export const codingReadFileTool: ToolDef<typeof readSchema> = {
  name: "coding.read_file",
  description: "Read a file from the coding workspace (relative path, forward slashes). Bounded output.",
  inputSchema: readSchema,
  riskLevel: "low",
  execute: async (args, ctx) => {
    const ws = needWs(ctx);
    const r = await readText(ws, args.path);
    if (!r.ok) return { content: `Cannot read ${args.path}: ${r.error}`, data: { error: r.error } };
    return { content: `### ${args.path}\n\`\`\`\n${capContent(r.content, args.maxChars)}\n\`\`\``, data: { path: args.path, length: r.content.length } };
  },
};

const listSchema = z.object({
  dir: z.string().optional().default("."),
  limit: z.number().int().max(200).optional().default(80),
});

export const codingListFilesTool: ToolDef<typeof listSchema> = {
  name: "coding.list_files",
  description: "List files in the coding workspace (or a subdirectory), respecting ignore rules.",
  inputSchema: listSchema,
  riskLevel: "low",
  execute: async (args, ctx) => {
    const ws = needWs(ctx);
    const files = await prisma.codebaseFile.findMany({
      where: { workspaceId: ws },
      select: { path: true, language: true, lineCount: true },
      orderBy: { path: "asc" },
      take: args.limit,
    });
    const prefix = args.dir === "." || args.dir === "/" ? "" : `${args.dir.replace(/^\//, "")}/`;
    const inDir = files.filter((f) => f.path.startsWith(prefix) && f.path.length > prefix.length && !f.path.slice(prefix.length).includes("/"));
    const shown = inDir.length ? inDir : files.slice(0, args.limit);
    const content = shown.map((f) => `${f.path} (${f.language}, ${f.lineCount ?? "?"} lines)`).join("\n");
    return { content: content || "No files.", data: { files: shown } };
  },
};

export const codingArchitectureTool: ToolDef = {
  name: "coding.architecture",
  description: "Generate the architecture report of the coding workspace: files, lines, languages, directories, entry points, top dependencies, unresolved imports.",
  inputSchema: z.object({}),
  riskLevel: "low",
  execute: async (_args, ctx) => {
    const ws = needWs(ctx);
    const arch = await buildArchitecture(ws, ctx.userId);
    const lines = [
      `Entry points: ${arch.entryPoints.join(", ") || "none"}`,
      `Files: ${arch.files} | Lines: ${arch.lines}`,
      `Languages: ${Object.entries(arch.languages).map(([k, v]) => `${k}(${v})`).join(", ")}`,
      `Top dependencies: ${arch.topDependencies.slice(0, 10).map((d) => `${d.name}(${d.count})`).join(", ") || "none"}`,
      ...(arch.unresolvedImports.length ? [`Unresolved imports (${arch.unresolvedImports.length}): ${arch.unresolvedImports.slice(0, 8).map((i) => i.target).join(", ")}`] : ["No unresolved local imports."]),
    ];
    return { content: lines.join("\n"), data: arch };
  },
};

const searchSymbolsSchema = z.object({
  query: z.string().optional().default(""),
  file: z.string().optional(),
  limit: z.number().int().max(80).optional().default(40),
});

export const codingSymbolsTool: ToolDef<typeof searchSymbolsSchema> = {
  name: "coding.symbols",
  description: "List code symbols (functions, classes, types, hooks) in the workspace, filtered by file or name.",
  inputSchema: searchSymbolsSchema,
  riskLevel: "low",
  execute: async (args, ctx) => {
    const ws = needWs(ctx);
    const syms = await prisma.codeSymbol.findMany({
      where: {
        workspaceId: ws,
        ...(args.file ? { file: { path: args.file } } : {}),
        ...(args.query ? { name: { contains: args.query } } : {}),
      },
      select: { name: true, kind: true, lineStart: true, access: true, file: { select: { path: true } } },
      orderBy: { name: "asc" },
      take: args.limit,
    });
    const content = syms.map((s) => `${s.access ? s.access + " " : ""}${s.kind} ${s.name} (${s.file.path}:${s.lineStart})`).join("\n");
    return { content: content || "No symbols.", data: { symbols: syms } };
  },
};

const explainSchema = z.object({ question: z.string().min(1) });

export const codingExplainTool: ToolDef<typeof explainSchema> = {
  name: "coding.explain",
  description: "Ask a question about this repository and get a grounded answer citing file:line locations.",
  inputSchema: explainSchema,
  riskLevel: "low",
  execute: async (args, ctx) => {
    const ws = needWs(ctx);
    const res = await CodingAgent.ask(ctx.userId, ws, args.question);
    return { content: res.answer, data: { usedFiles: res.usedFiles } };
  },
};

const proposeSchema = z.object({
  prompt: z.string().min(1),
  files: z.array(z.string()).optional(),
});

export const codingProposeChangeTool: ToolDef<typeof proposeSchema> = {
  name: "coding.propose_change",
  description: "Propose edits to files in the workspace from a natural-language prompt. Returns a diff. Nothing is written until apply_change is confirmed.",
  inputSchema: proposeSchema,
  riskLevel: "high",
  execute: async (args, ctx) => {
    const ws = needWs(ctx);
    const changes = await CodingAgent.proposeChanges(ctx.userId, ws, { prompt: args.prompt, files: args.files });
    if (!changes.length) return { content: "No changes proposed — target the specific file(s) the coding model should edit." };
    const content = changes.map((c) => `PROPOSED ${c.action} on ${c.filePath} (+${c.additions}/-${c.deletions})\n${(c.diffPreview ?? "").slice(0, 1500)}`).join("\n\n---\n\n");
    return { content: `Approve with coding.apply_change (change ids: ${changes.map((c) => c.id).join(", ")}).\n\n${content}`, data: { changes } };
  },
};

const applySchema = z.object({
  taskId: z.string().min(1),
  runTests: z.boolean().optional().default(true),
  testCommand: z.string().optional(),
});

export const codingApplyChangeTool: ToolDef<typeof applySchema> = {
  name: "coding.apply_change",
  description: "Apply the approved diffs of a coding task. REQUIRES explicit confirmation (confirmed=true). Creates a snapshot first; can verify with tests.",
  inputSchema: applySchema,
  riskLevel: "critical",
  execute: async (args, ctx) => {
    needConfirm(ctx, "coding.apply_change");
    const res = await CodingAgent.apply(args.taskId, { confirmed: true, runTests: args.runTests, testCommand: args.testCommand });
    const testLine = res.test ? `Tests: ${res.test.ok ? "PASSED" : "FAILED"} (exit ${res.test.exitCode})\n${res.test.stdout.slice(-600)}` : "";
    return { content: `Applied ${res.applied} change(s).\n${testLine || ""}${res.reason ? `\nNote: ${res.reason}` : ""}`, data: res };
  },
};

const commandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
});

export const codingRunCommandTool: ToolDef<typeof commandSchema> = {
  name: "coding.run_command",
  description: "Run an allowlisted sandboxed command inside the workspace (npm test, node, python, git status…). High-risk commands need confirmation.",
  inputSchema: commandSchema,
  riskLevel: "critical",
  execute: async (args, ctx) => {
    const ws = needWs(ctx);
    const risk = analyzeCommand(args.args?.length ? `${args.command} ${args.args.join(" ")}` : args.command);
    if (risk.blocked || risk.level === "critical") {
      return { content: `Command blocked: ${risk.notes.join("; ")}`, data: { blocked: true, notes: risk.notes } };
    }
    if (risk.level === "high") needConfirm(ctx, "coding.run_command");
    const res = await CodingAgent.run(ctx.userId, ws, { command: args.command, args: args.args, confirmed: ctx.confirmed === true });
    return { content: `exit=${res.exitCode}\n${res.stdout.slice(0, 2000)}${res.stderr ? `\nSTDERR:\n${res.stderr.slice(0, 1000)}` : ""}`, data: { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr } };
  },
};

const testSchema = z.object({ command: z.string().optional() });

export const codingRunTestTool: ToolDef<typeof testSchema> = {
  name: "coding.run_test",
  description: "Run the workspace test suite (auto-detected or a specific command). Low risk of mutation; may be slow.",
  inputSchema: testSchema,
  riskLevel: "medium",
  execute: async (args, ctx) => {
    const ws = needWs(ctx);
    const res = await CodingAgent.test(ctx.userId, ws, { command: args.command });
    return {
      content: `Test run ${res.ok ? "PASSED" : "FAILED"} (exit ${res.exitCode ?? "?"}, ${res.durationMs}ms)\n${(res.stdout + res.stderr).slice(0, 2000)}`,
      data: { ok: res.ok, exitCode: res.exitCode, durationMs: res.durationMs, output: res.stdout, testRunId: res.testRunId },
    };
  },
};

const gitSchema = z.object({ action: z.string().min(1), args: z.array(z.string()).optional().default([]) });

export const codingGitTool: ToolDef<typeof gitSchema> = {
  name: "coding.git",
  description: "Read-only git — status, diff, log, branch, show. Writing (commit/init) requires confirmed=true plus GIT_WRITE permission. Never pushes.",
  inputSchema: gitSchema,
  riskLevel: "medium",
  execute: async (args, ctx) => {
    const ws = needWs(ctx);
    const isWrite = args.action === "commit" || args.action === "init";
    if (isWrite) {
      needConfirm(ctx, "coding.git");
      const res = await CodingAgent.gitOperation(ctx.userId, ws, { action: args.action, args: args.args, confirmed: true });
      return { content: res.output || (res.ok ? "Git completed." : "Git failed."), data: res };
    }
    const res = await CodingAgent.gitOperation(ctx.userId, ws, { action: args.action, args: args.args });
    return { content: res.output || (res.ok ? "(empty)" : `Git error: ${res.output}`), data: res };
  },
};

export const codingTools: ToolDef[] = [
  codingSearchTool,
  codingReadFileTool,
  codingListFilesTool,
  codingArchitectureTool,
  codingSymbolsTool,
  codingExplainTool,
  codingProposeChangeTool,
  codingApplyChangeTool,
  codingRunCommandTool,
  codingRunTestTool,
  codingGitTool,
];
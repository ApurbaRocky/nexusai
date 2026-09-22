/**
 * CodingAgent — the Phase 6 orchestrator (spec §14, §16, §17, §31–§33).
 *
 * Owns the lifecycle: workspace CRUD → index → plan → propose → (explicit
 * approval) → apply → test → rollback, plus command runs, git reads and
 * LLM "understand" answers. All disk writes go through the workspace sandbox;
 * every mutation is recorded (changes/patches/checkpoints/snapshots) so the
 * user can inspect and roll back.
 */
import { prisma } from "@/database/client";
import {
  ensureWorkspaceDir,
  removeWorkspaceDir,
  workspaceRoot,
  readText,
  writeText,
  deleteFile,
  renameFile,
  snapshotWorkspace,
  restoreSnapshot,
  importZip,
  workspaceFileHash,
  parseGitignore,
} from "@/agents/coding/workspace";
import { indexWorkspace } from "@/agents/coding/indexer";
import { buildArchitecture } from "@/agents/coding/architecture";
import { planTask, reviewFiles, debugSymptom, refactorContent, generateDocs } from "@/agents/coding/engines";
import { codingComplete } from "@/agents/coding/llm";
import { codeSearch } from "@/agents/coding/code-search";
import { lineDiff, diffSummary, renderUnifiedDiff } from "@/agents/coding/diff";
import { analyzeCommand, runCommand, defaultTestCommand, type RunResult } from "@/agents/coding/commands";
import { GitService } from "@/agents/coding/git";
import { parsePermission, canEditFiles, canEditWorkspace, canRunCommands, canGitWrite, DEFAULT_PERMISSION } from "@/agents/coding/permissions";
import { sha256, capContent } from "@/agents/coding/hash";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { CodingPlanData, ProposedChange } from "@/agents/coding/types";

export interface WorkspaceCreateInput {
  userId: string;
  name: string;
  description?: string;
  projectId?: string;
  sourceType?: "upload" | "empty" | "local";
  zip?: Buffer;
  localPath?: string;
  ignorePatterns?: string[];
  gitInit?: boolean;
  permissionLevel?: string;
}

export interface AskResult {
  answer: string;
  usedFiles: string[];
  mode: string;
}

const IGNORE_ADDITIONS = ["node_modules/*", ".git/*", ".next/*", "dist/*", "build/*", "coverage/*", ".venv/*", "__pycache__/*"];

export class CodingAgent {
  // -------------------------------------------------------------------------
  // Workspace lifecycle
  // -------------------------------------------------------------------------

  static async createWorkspace(input: WorkspaceCreateInput) {
    if (input.sourceType === "local" && input.localPath) {
      // Bind to a server-chosen absolute path (admin flows only). Still sandboxed
      // relative to that root by resolveWithin checks at read time.
      const root = path.resolve(input.localPath);
      await mkdir(root, { recursive: true });
      const ws = await prisma.codingWorkspace.create({
        data: {
          userId: input.userId,
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? "",
          sourceType: "local",
          rootPath: root,
          ignorePatterns: JSON.stringify([...IGNORE_ADDITIONS, ...(input.ignorePatterns ?? [])]),
          permissionLevel: parsePermission(input.permissionLevel ?? DEFAULT_PERMISSION) as string,
        },
      });
      return { workspace: ws, imported: 0 };
    }

    const ws = await prisma.codingWorkspace.create({
      data: {
        userId: input.userId,
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? "",
        sourceType: input.sourceType === "empty" ? "empty" : "upload",
        ignorePatterns: JSON.stringify([...IGNORE_ADDITIONS, ...(input.ignorePatterns ?? [])]),
        permissionLevel: parsePermission(input.permissionLevel ?? DEFAULT_PERMISSION) as string,
      },
    });

    let imported = 0;
    if (input.zip) {
      const res = await importZip(ws.id, input.zip);
      imported = res.imported;
    } else {
      await ensureWorkspaceDir(ws.id);
      await writeText(ws.id, "README.md", `# ${ws.name}\n\nCreated by the AI Coding workspace.\n`);
    }

    if (input.gitInit) {
      const git = new GitService(ws.id);
      if (!(await git.repoExists())) await git.init();
      await prisma.gitOperation.create({ data: { workspaceId: ws.id, userId: input.userId, action: "init", status: "completed", writeAccess: true, confirmed: true } });
    }

    await prisma.codingWorkspace.update({ where: { id: ws.id }, data: { status: "ready" } });
    return { workspace: ws, imported };
  }

  static async deleteWorkspace(userId: string, workspaceId: string): Promise<void> {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");
    // RAG docs cleanup to avoid orphans.
    const docs = await prisma.document.findMany({ where: { userId, meta: { contains: `"codingWorkspaceId":"${workspaceId}"` } }, select: { id: true } });
    const { getVectorStore } = await import("@/rag/vector-store");
    const store = getVectorStore();
    for (const d of docs) {
      await store.deleteByDocument(d.id).catch(() => {});
    }
    await prisma.document.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } }).catch(() => {});
    await prisma.codingWorkspace.delete({ where: { id: workspaceId } });
    await removeWorkspaceDir(workspaceId);
  }

  static async getWorkspace(userId: string, workspaceId: string) {
    return prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
  }

  static async updatePermission(userId: string, workspaceId: string, level: string) {
    const parsed = parsePermission(level);
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");
    return prisma.codingWorkspace.update({ where: { id: workspaceId }, data: { permissionLevel: parsed } });
  }

  static async index(userId: string, workspaceId: string) {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");
    return indexWorkspace(workspaceId, userId);
  }

  // -------------------------------------------------------------------------
  // Understand / ask
  // -------------------------------------------------------------------------

  static async ask(userId: string, workspaceId: string, question: string): Promise<AskResult> {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");

    const [arch, hits] = await Promise.all([
      buildArchitecture(workspaceId, userId),
      codeSearch(workspaceId, userId, { query: question, limit: 8 }).catch(() => []),
    ]);
    const usedFiles = [...new Set(hits.map((h) => h.path))].slice(0, 12);

    const excerpts: string[] = [];
    for (const f of usedFiles.slice(0, 6)) {
      const r = await readText(workspaceId, f);
      if (r.ok) excerpts.push(`### ${f}\n\`\`\`\n${capContent(r.content, 2500)}\n\`\`\``);
    }

    const system = `You are the AI Nexus coding copilot. Answer concretely about THIS repository using only the provided index and excerpts. Quote file:line and symbols. Never invent files or claims. Keep it under ~500 words.`;
    const userMsg = `QUESTION: ${question}\n\nARCHITECTURE:\nFiles ${arch.files}, ${arch.lines} lines. Languages: ${Object.entries(arch.languages)
      .map(([k, v]) => `${k}(${v})`)
      .join(", ")}. Entry points: ${arch.entryPoints.join(", ") || "none"}.\nTop deps: ${arch.topDependencies.slice(0, 6).map((d) => d.name).join(", ") || "none"}.\nUnresolved imports: ${arch.unresolvedImports.slice(0, 4).map((i) => i.target).join(", ") || "none"}.\n\nMATCHING LOCATIONS:\n${hits
      .slice(0, 8)
      .map((h) => `${h.path}:${h.line} — ${h.content.slice(0, 140)}`)
      .join("\n") || "none"}\n\nFILE EXCERPTS:\n${excerpts.join("\n\n") || "none"}`;

    let answer: string;
    try {
      answer = await codingComplete(userId, { system, messages: [{ role: "user", content: userMsg }] });
    } catch {
      const relevant = hits.slice(0, 5).map((h) => `- ${h.path}:${h.line} ${h.content.slice(0, 100)}`).join("\n");
      answer = `(Coding model unavailable — deterministic answer from the index.)\n\nArchitecture: ${arch.files} files, ${arch.lines} lines across ${Object.keys(arch.languages).join(", ")}. Entry points: ${arch.entryPoints.join(", ") || "none"}.\n\nPotentially relevant code:\n${relevant || "No direct matches; try re-indexing or a more specific question."}`;
    }
    return { answer, usedFiles, mode: "understand" };
  }

  // -------------------------------------------------------------------------
  // Plan → propose → approve → apply → test → record
  // -------------------------------------------------------------------------

  static async plan(userId: string, workspaceId: string, prompt: string): Promise<CodingPlanData & { taskId: string }> {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");

    const task = await prisma.codingTask.create({
      data: { workspaceId, userId, title: prompt.slice(0, 80), description: prompt, mode: "plan", status: "planning", startedAt: new Date() },
    });

    const data = await planTask({ workspaceId, userId }, prompt);
    const filesAffected = [...new Set(data.steps.flatMap((s) => s.files ?? []))];

    await prisma.$transaction([
      prisma.codingPlan.create({
        data: {
          taskId: task.id,
          workspaceId,
          userId,
          title: data.summary,
          steps: JSON.stringify(data.steps.map((s, i) => ({ step: i + 1, title: s.title, detail: s.description, files: s.files ?? [], tool: null }))),
          filesAffected: JSON.stringify(filesAffected),
          risks: JSON.stringify(data.risks ?? []),
          status: "proposed",
        },
      }),
      prisma.codingTask.update({
        where: { id: task.id },
        data: { status: "awaiting_approval", plan: JSON.stringify(data.steps.map((s, i) => ({ step: i + 1, title: s.title, detail: s.description, files: s.files ?? [], tool: null, done: false }))) },
      }),
    ]);

    return { ...data, taskId: task.id };
  }

  /** Produce concrete CodingChanges for an implement prompt (needs an LLM). */
  static async proposeChanges(userId: string, workspaceId: string, opts: { prompt: string; files?: string[] }): Promise<ProposedChange[]> {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");

    const task = await prisma.codingTask.create({
      data: { workspaceId, userId, title: opts.prompt.slice(0, 80), description: opts.prompt, mode: "implement", status: "awaiting_approval", startedAt: new Date() },
    });

    const refactor = await refactorContent({ workspaceId, userId }, opts.prompt, opts.files ?? []);
    const changes: ProposedChange[] = [];
    for (const c of refactor.changes) {
      const current = await readText(workspaceId, c.path);
      const oldContent = current.ok ? current.content : "";
      const newContent = c.suggestedContent;
      if (!newContent || newContent === oldContent) continue;
      const ops = lineDiff(oldContent, newContent);
      const sum = diffSummary(ops);
      const change = await prisma.codingChange.create({
        data: {
          taskId: task.id,
          workspaceId,
          userId,
          filePath: c.path,
          action: "edit",
          baseHash: oldContent ? sha256(oldContent) : null,
          targetHash: sha256(newContent),
          oldContent,
          newContent,
          diffPreview: renderUnifiedDiff(oldContent, newContent, { maxLines: 2000 }),
          summary: JSON.stringify(sum),
          status: "proposed",
          remark: c.description,
        },
      });
      await prisma.codingPatch.create({
        data: {
          changeId: change.id,
          taskId: task.id,
          workspaceId,
          userId,
          title: c.description || `Edit ${c.path}`,
          ops: JSON.stringify(ops.slice(0, 400).map((o) => ({ t: o.type, a: "oldLine" in o ? o.oldLine : o.newLine, s: o.text }))),
        },
      });
      changes.push({
        id: change.id,
        taskId: task.id,
        filePath: c.path,
        action: "edit",
        summary: c.description,
        additions: sum.additions,
        deletions: sum.deletions,
        status: "proposed",
        oldContent,
        newContent,
        diffPreview: change.diffPreview ?? "",
      });
    }

    if (!changes.length) {
      await prisma.codingTask.update({ where: { id: task.id }, data: { status: "cancelled", result: JSON.stringify({ message: "No concrete changes could be proposed (coding model unavailable for this prompt)." }) } });
    }

    return changes;
  }

  /**
   * Apply all proposed changes of a task. Requires confirmed === true (the
   * user explicitly approved the diff) and permission ≥ EDIT_APPROVED_FILES.
   * Deletes additionally require WORKSPACE_EDIT. Never runs automatically.
   */
  static async apply(taskId: string, opts: { confirmed: boolean; runTests?: boolean; testCommand?: string }): Promise<{ applied: number; rolledBack: boolean; reason?: string; test?: RunResult }> {
    const task = await prisma.codingTask.findUnique({ where: { id: taskId }, include: { changes: true, workspace: true } });
    if (!task) throw new Error("Task not found.");
    if (!opts.confirmed) throw new Error("Changes were not approved.");

    const level = parsePermission(task.workspace.permissionLevel);
    const pending = task.changes.filter((c) => c.status === "proposed");
    if (!pending.length) return { applied: 0, rolledBack: false, reason: "No proposed changes on this task." };

    for (const c of pending) {
      if (c.action === "delete" && !canEditWorkspace(level)) {
        throw new Error("Deleting files requires the WORKSPACE_EDIT permission.");
      }
      if (c.action !== "delete" && !canEditFiles(level)) {
        throw new Error(`Applying "${c.filePath}" requires the EDIT_APPROVED_FILES permission. Raise it on the workspace settings.`);
      }
    }

    // Checkpoint before mutating.
    const snap = await snapshotWorkspace(task.workspaceId);
    const fileHashes: Record<string, string> = {};
    for (const [p, content] of Object.entries(snap)) fileHashes[p] = sha256(content);
    await prisma.codingCheckpoint.create({
      data: { taskId, workspaceId: task.workspaceId, userId: task.userId, label: `task:${task.title.slice(0, 60)}`, fileHashes: JSON.stringify(fileHashes) },
    });

    await prisma.codingTask.update({ where: { id: taskId }, data: { status: "applying" } });

    let applied = 0;
    for (const c of pending) {
      const prior = (await readText(task.workspaceId, c.filePath).catch(() => ({ ok: false as const, error: "read" })));
      let result: { ok: boolean; error?: string } = { ok: false, error: "unknown action" };
      switch (c.action) {
        case "create":
        case "edit": {
          if (c.baseHash && prior.ok && c.baseHash !== sha256(prior.content)) {
            result = { ok: false, error: "baseline changed (conflict)" };
            break;
          }
          result = c.newContent !== undefined && c.newContent !== null ? await writeText(task.workspaceId, c.filePath, c.newContent) : { ok: false, error: "missing content" };
          break;
        }
        case "delete":
          result = await deleteFile(task.workspaceId, c.filePath);
          break;
        case "rename":
          result = c.newPath ? await renameFile(task.workspaceId, c.filePath, c.newPath) : { ok: false, error: "missing newPath" };
          break;
      }
      if (!result.ok) {
        await prisma.codingChange.update({ where: { id: c.id }, data: { status: "conflict", remark: result.error } });
        continue;
      }
      applied++;
      await prisma.codingChange.update({ where: { id: c.id }, data: { status: "applied", appliedAt: new Date() } });
      await prisma.codingPatch.updateMany({ where: { changeId: c.id }, data: { status: "applied", appliedAt: new Date(), rollbackData: prior.ok ? JSON.stringify({ path: c.filePath, content: prior.content ?? "" }) : null } });
    }

    // Refresh the index so search/symbols reflect the applied edits.
    let test: RunResult | undefined;
    try {
      await indexWorkspace(task.workspaceId, task.userId);
    } catch {
      /* index errors recorded on the workspace; not fatal for the task */
    }

    if (applied === 0) {
      // Restore safety: nothing applied, keep checkpoint anyway.
      await prisma.codingTask.update({ where: { id: taskId }, data: { status: "failed", error: "All proposed changes conflicted or failed." } });
      return { applied: 0, rolledBack: false, reason: "All proposed changes conflicted or failed." };
    }

    if (opts.runTests) {
      const cmd = opts.testCommand || (await defaultTestCommand(task.workspaceId)).command;
      if (cmd) {
        const runRow = await prisma.codingTestRun.create({
          data: { workspaceId: task.workspaceId, userId: task.userId, taskId, command: cmd, status: "running", startedAt: new Date() },
        });
        test = await runCommand(cmd, { cwd: workspaceRoot(task.workspaceId), timeoutMs: 120_000 });
        await prisma.codingTestRun.update({
          where: { id: runRow.id },
          data: {
            status: test.ok ? "passed" : "failed",
            exitCode: test.exitCode,
            stdout: test.stdout?.slice(0, 20_000),
            stderr: test.stderr?.slice(0, 20_000),
            output: (test.stdout + test.stderr).slice(0, 30_000),
            durationMs: test.durationMs,
            completedAt: new Date(),
          },
        });
      }
    }

    await prisma.codingTask.update({
      where: { id: taskId },
      data: {
        status: "done",
        result: JSON.stringify({ applied, testsPassed: test ? test.ok : null }),
        completedAt: new Date(),
      },
    });

    return { applied, rolledBack: false, test };
  }

  static async rejectTask(taskId: string): Promise<void> {
    const task = await prisma.codingTask.findUnique({ where: { id: taskId } });
    if (!task) throw new Error("Task not found.");
    await prisma.$transaction([
      prisma.codingTask.update({ where: { id: taskId }, data: { status: "cancelled", completedAt: new Date() } }),
      prisma.codingChange.updateMany({ where: { taskId }, data: { status: "rejected" } }),
      prisma.codingPlan.updateMany({ where: { taskId }, data: { status: "rejected" } }),
    ]);
  }

  /** Roll back to a snapshot (checkpoint/snapshot row) and re-index. */
  static async restore(userId: string, workspaceId: string, snapshotId: string): Promise<{ restored: number }> {
    const snap = await prisma.codingSnapshot.findFirst({
      where: { id: snapshotId, workspaceId, userId },
      include: { task: true },
    });
    if (!snap) throw new Error("Snapshot not found.");
    let files: Record<string, string>;
    try {
      files = JSON.parse(snap.files) as Record<string, string>;
    } catch {
      throw new Error("Snapshot data corrupted.");
    }
    const res = await restoreSnapshot(workspaceId, files);
    if (res.failed.length) throw new Error(`Restore partially failed: ${res.failed.join(", ")}`);
    if (snap.taskId) {
      await prisma.codingTask.update({ where: { id: snap.taskId }, data: { status: "cancelled", error: "Rolled back to snapshot" } });
    }
    await indexWorkspace(workspaceId, userId).catch(() => {});
    return { restored: res.restored };
  }

  static async checkpoint(userId: string, workspaceId: string, label: string): Promise<string> {
    const snap = await snapshotWorkspace(workspaceId);
    const row = await prisma.codingSnapshot.create({
      data: { workspaceId, userId, reason: label, files: JSON.stringify(snap) },
    });
    return row.id;
  }

  // -------------------------------------------------------------------------
  // Commands / tests / git
  // -------------------------------------------------------------------------

  static async run(userId: string, workspaceId: string, opts: { command: string; args?: string[]; confirmed: boolean }): Promise<RunResult & { risk: ReturnType<typeof analyzeCommand>; recorded: boolean }> {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");
    const level = parsePermission(ws.permissionLevel);
    if (!canRunCommands(level)) throw new Error("Command execution is not granted for this workspace.");

    const full = opts.args?.length ? `${opts.command} ${opts.args.join(" ")}` : opts.command;
    const risk = analyzeCommand(full);

    if (risk.blocked || risk.level === "critical") {
      await prisma.codingCommand.create({
        data: { workspaceId, userId, command: full, riskLevel: risk.level, permission: "blocked", status: "blocked", blockedReason: risk.notes.join("; ") },
      });
      throw new Error(`Command blocked: ${risk.notes.join("; ")}`);
    }
    if (risk.level === "high" && !opts.confirmed) {
      await prisma.codingCommand.create({
        data: { workspaceId, userId, command: full, riskLevel: "high", permission: "needs_confirmation", status: "blocked", blockedReason: "High-risk command requires explicit confirmation." },
      });
      throw new Error("High-risk command requires explicit confirmation before running.");
    }

    const row = await prisma.codingCommand.create({
      data: { workspaceId, userId, command: full, cwd: workspaceRoot(workspaceId), riskLevel: risk.level, permission: "granted", status: "running" },
    });
    const result = await runCommand(full, { cwd: workspaceRoot(workspaceId), timeoutMs: 120_000 });
    await prisma.codingCommand.update({
      where: { id: row.id },
      data: {
        status: result.ok ? "completed" : "failed",
        exitCode: result.exitCode,
        stdout: result.stdout?.slice(0, 20_000),
        stderr: result.stderr?.slice(0, 20_000),
        durationMs: result.durationMs,
        finishedAt: new Date(),
      },
    });
    return { ...result, risk, recorded: true };
  }

  static async test(userId: string, workspaceId: string, opts: { command?: string; taskId?: string }): Promise<RunResult & { testRunId: string }> {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");
    const level = parsePermission(ws.permissionLevel);
    if (!canRunCommands(level)) throw new Error("Command execution is not granted for this workspace.");

    const command = opts.command || (await defaultTestCommand(workspaceId)).command;
    if (!command) throw new Error("No test command configured or detected.");

    const row = await prisma.codingTestRun.create({
      data: { workspaceId, userId, taskId: opts.taskId, command, status: "running", startedAt: new Date() },
    });
    const result = await runCommand(command, { cwd: workspaceRoot(workspaceId), timeoutMs: 300_000 });
    await prisma.codingTestRun.update({
      where: { id: row.id },
      data: {
        status: result.ok ? "passed" : "failed",
        exitCode: result.exitCode,
        stdout: result.stdout?.slice(0, 25_000),
        stderr: result.stderr?.slice(0, 25_000),
        output: (result.stdout + result.stderr).slice(0, 40_000),
        durationMs: result.durationMs,
        completedAt: new Date(),
      },
    });
    return { ...result, testRunId: row.id };
  }

  static git(userId: string, workspaceId: string) {
    return new GitService(workspaceId);
  }

  static async gitOperation(userId: string, workspaceId: string, opts: { action: string; args: string[]; confirmed?: boolean }): Promise<{ output: string; ok: boolean; write: boolean }> {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");
    const level = parsePermission(ws.permissionLevel);
    const git = new GitService(workspaceId);

    if (opts.action === "commit" || opts.action === "init") {
      if (!canGitWrite(level)) throw new Error("Git write requires the GIT_WRITE permission.");
      if (!opts.confirmed) throw new Error("This git action requires explicit confirmation.");
      const r = opts.action === "commit" ? await git.commit(opts.args.join(" ") || "ai-nexus: committed changes") : await git.init();
      await prisma.gitOperation.create({
        data: { workspaceId, userId, action: opts.action, params: JSON.stringify({ args: opts.args }), output: r.stdout.slice(0, 4000), status: r.ok ? "completed" : "failed", writeAccess: true, confirmed: true },
      });
      return { output: r.stdout, ok: r.ok, write: true };
    }

    const r = await git.assertReadOnly(opts.args, opts.action);
    await prisma.gitOperation.create({
      data: { workspaceId, userId, action: opts.action, params: JSON.stringify({ args: opts.args }), output: r.stdout.slice(0, 4000), status: r.ok ? "completed" : "failed", writeAccess: false, confirmed: false },
    });
    return { output: r.stdout, ok: r.ok, write: false };
  }

  // -------------------------------------------------------------------------
  // Review / refactor / docs (non-mutating; callers decide to propose/applied)
  // -------------------------------------------------------------------------

  static async review(userId: string, workspaceId: string, files?: string[]) {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");
    let targets = files ?? [];
    if (!targets.length) {
      const recent = await prisma.codebaseFile.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" }, take: 8, select: { path: true } });
      targets = recent.map((r) => r.path);
    }
    return reviewFiles({ workspaceId, userId }, targets);
  }

  static async debug(userId: string, workspaceId: string, symptom: string) {
    return debugSymptom({ workspaceId, userId }, symptom);
  }

  static async refactor(userId: string, workspaceId: string, prompt: string, files?: string[]) {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");
    const plan = await planTask({ workspaceId, userId }, prompt);
    let targets = files ?? [];
    if (!targets.length) targets = plan.steps.flatMap((s) => s.files ?? []).slice(0, 5);
    return refactorContent({ workspaceId, userId }, prompt, targets);
  }

  static async docs(userId: string, workspaceId: string, prompt: string, files?: string[]) {
    const ws = await prisma.codingWorkspace.findFirst({ where: { id: workspaceId, userId } });
    if (!ws) throw new Error("Workspace not found.");
    let targets = files ?? [];
    if (!targets.length) {
      const recent = await prisma.codebaseFile.findMany({ where: { workspaceId }, orderBy: { lineCount: "desc" }, take: 5, select: { path: true } });
      targets = recent.map((r) => r.path);
    }
    return generateDocs({ workspaceId, userId }, prompt, targets);
  }

  static async gitignoreSummary(workspaceId: string): Promise<string[]> {
    const r = await readText(workspaceId, ".gitignore");
    if (!r.ok) return [];
    return parseGitignore(r.content).effective;
  }

  static async currentFileHash(workspaceId: string, rel: string): Promise<string | null> {
    return workspaceFileHash(workspaceId, rel);
  }
}
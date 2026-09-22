/**
 * Client-side typed helpers for the Phase 6 coding workspace endpoints.
 */
export interface CodingWorkspaceRow {
  id: string;
  name: string;
  description: string;
  projectId: string | null;
  sourceType: string;
  status: string;
  language: string | null;
  framework: string | null;
  permissionLevel: string;
  indexError: string | null;
  lastIndexedAt: string | null;
  stats: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CodingWorkspaceListItem extends CodingWorkspaceRow {
  _count?: { files: number; tasks: number; changes: number; testRuns: number };
}

export interface CodingWorkspaceDetail {
  workspace: CodingWorkspaceRow;
  files: CodingFileRow[];
  tasks: CodingTaskLite[];
  changes: CodingChangeRow[];
  snapshots: { id: string; reason: string; taskId: string | null; createdAt: string }[];
  counts: { files: number; tasks: number; changes: number };
}

export interface CodingFileRow {
  id: string;
  path: string;
  language: string;
  sizeBytes: number;
  lineCount: number | null;
  hash: string;
  isTest: boolean;
  isConfig: boolean;
  isDoc: boolean;
  updatedAt: string;
}

export interface CodingTaskLite {
  id: string;
  title: string;
  mode: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface CodingChangeRow {
  id: string;
  taskId: string | null;
  filePath: string;
  action: string;
  status: string;
  summary: string | null;
  diffPreview: string | null;
  oldContent: string | null;
  newContent: string | null;
  remark: string | null;
  createdAt: string;
}

export interface SearchHit {
  path: string;
  line: number;
  content: string;
  kind: string;
}

export interface ArchitectureReportRow {
  entryPoints: string[];
  files: number;
  lines: number;
  languages: Record<string, number>;
  directories: Record<string, number>;
  topDependencies: { name: string; count: number; local: boolean }[];
  unresolvedImports: { target: string; from: string }[];
}

export interface PlanRow {
  taskId: string;
  summary: string;
  goals: string[];
  steps: { title: string; description: string; files: string[]; dependsOn?: string[]; duration?: string }[];
  risks: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data as { error?: string })?.error ?? "Coding request failed");
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }
  return data as T;
}

export const codingApi = {
  list: () => request<{ workspaces: CodingWorkspaceListItem[] }>("/api/coding"),

  createJson: (body: { name: string; description?: string; projectId?: string; sourceType: "empty"; gitInit?: boolean; ignorePatterns?: string[] }) =>
    request<{ workspace: CodingWorkspaceRow; imported: number }>("/api/coding", { method: "POST", body: JSON.stringify(body) }),

  createZip: async (file: File, opts: { name: string; description?: string; projectId?: string; gitInit?: boolean }) => {
    const form = new FormData();
    form.append("name", opts.name);
    if (opts.description) form.append("description", opts.description);
    if (opts.projectId) form.append("projectId", opts.projectId);
    if (opts.gitInit) form.append("gitInit", "true");
    form.append("zip", file);
    return request<{ workspace: CodingWorkspaceRow; imported: number }>("/api/coding", { method: "POST", body: form });
  },

  detail: (id: string) => request<CodingWorkspaceDetail>(`/api/coding/${id}`),
  patch: (id: string, body: { name?: string; description?: string; permissionLevel?: string; ignorePatterns?: string[] }) =>
    request<{ ok: boolean; workspace: CodingWorkspaceRow }>(`/api/coding/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/coding/${id}`, { method: "DELETE" }),

  index: (id: string) => request<{ files: number; symbols: number; dependencies: number; lines: number; languages: Record<string, number>; skippedBinary: number; indexedToRag: number; durationMs: number }>(`/api/coding/${id}/index`, { method: "POST" }),

  search: (id: string, query: string, mode = "auto") =>
    request<SearchHit[]>(`/api/coding/${id}/search?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`),

  architecture: (id: string) => request<ArchitectureReportRow>(`/api/coding/${id}/architecture`),

  symbols: (id: string, opts: { file?: string; q?: string } = {}) =>
    request<{ id: string; name: string; kind: string; lineStart: number; lineEnd: number | null; signature: string | null; access: string | null; file: { path: string } }[]>(
      `/api/coding/${id}/symbols${opts.file ? `?file=${encodeURIComponent(opts.file)}` : ""}${opts.q ? `${opts.file ? "&" : "?"}q=${encodeURIComponent(opts.q)}` : ""}`,
    ),

  file: (id: string, path: string) => request<{ path: string; content: string }>(`/api/coding/${id}/file/${path.split("/").map(encodeURIComponent).join("/")}`),
  files: (id: string) => request<CodingFileRow[]>(`/api/coding/${id}/files`),

  tasks: (id: string) =>
    request<
      (CodingTaskLite & {
        plans: { id: string; title: string; steps: string; status: string }[];
        changes: CodingChangeRow[];
        testRuns: { id: string; command: string; status: string; exitCode: number | null; durationMs: number | null; createdAt: string }[];
      })[]
    >(`/api/coding/${id}/tasks`),

  ask: (id: string, question: string) => request<{ answer: string; usedFiles: string[]; mode: string }>(`/api/coding/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) }),

  plan: (id: string, prompt: string) => request<PlanRow>(`/api/coding/${id}/plan`, { method: "POST", body: JSON.stringify({ prompt }) }),

  propose: (id: string, prompt: string, files?: string[]) =>
    request<
      { id: string; taskId: string; filePath: string; action: string; summary: string | null; additions: number; deletions: number; status: string; oldContent: string; newContent: string; diffPreview: string }[]
    >(`/api/coding/${id}/propose`, { method: "POST", body: JSON.stringify({ prompt, files }) }),

  apply: (id: string, taskId: string, opts: { confirmed: boolean; runTests?: boolean; testCommand?: string }) =>
    request<{ applied: number; rolledBack: boolean; reason?: string; test?: { ok: boolean; exitCode: number | null; stdout: string; stderr: string } }>(
      `/api/coding/${id}/apply`,
      { method: "POST", body: JSON.stringify({ taskId, confirmed: opts.confirmed, runTests: opts.runTests, testCommand: opts.testCommand }) },
    ),

  reject: (id: string, taskId: string) => request<{ ok: boolean }>(`/api/coding/${id}/reject`, { method: "POST", body: JSON.stringify({ taskId }) }),

  checkpoint: (id: string, label: string) => request<{ snapshotId: string }>(`/api/coding/${id}/checkpoint`, { method: "POST", body: JSON.stringify({ label }) }),

  restore: (id: string, snapshotId: string) => request<{ restored: number }>(`/api/coding/${id}/restore`, { method: "POST", body: JSON.stringify({ snapshotId }) }),

  review: (id: string, files?: string[]) => request<{ severity: string; category: string; path: string; line: string; title: string; detail: string; suggestion: string }[]>(
    `/api/coding/${id}/review`,
    { method: "POST", body: JSON.stringify({ files }) },
  ),

  debug: (id: string, symptom: string) =>
    request<{ summary: string; symptom: string; probableRootCause: string; evidence: string[]; checkCommands: string[]; suggestedFile: string; suggestedFix: string; confidence: string }>(
      `/api/coding/${id}/debug`,
      { method: "POST", body: JSON.stringify({ symptom }) },
    ),

  refactor: (id: string, prompt: string, files?: string[]) =>
    request<{ summary: string; changes: { path: string; description: string; suggestedContent?: string; itemized: string[] }[] }>(
      `/api/coding/${id}/refactor`,
      { method: "POST", body: JSON.stringify({ prompt, files }) },
    ),

  docs: (id: string, prompt: string, files?: string[]) =>
    request<string>(`/api/coding/${id}/docs`, { method: "POST", body: JSON.stringify({ prompt, files }) }),

  command: (id: string, command: string, opts: { args?: string[]; confirmed?: boolean }) =>
    request<{ exitCode: number | null; stdout: string; stderr: string; durationMs: number; risk: string }>(
      `/api/coding/${id}/command`,
      { method: "POST", body: JSON.stringify({ command, args: opts.args ?? [], confirmed: opts.confirmed ?? false }) },
    ),

  test: (id: string, opts: { command?: string; taskId?: string } = {}) =>
    request<{ testRunId: string; ok: boolean; exitCode: number | null; stdout: string; stderr: string; durationMs: number }>(
      `/api/coding/${id}/test`,
      { method: "POST", body: JSON.stringify(opts) },
    ),

  git: (id: string, action: string, opts: { args?: string[]; confirmed?: boolean } = {}) =>
    request<{ ok: boolean; output: string; write: boolean }>(`/api/coding/${id}/git`, { method: action === "commit" || action === "init" ? "POST" : "GET", body: action === "commit" || action === "init" ? JSON.stringify({ action, args: opts.args ?? [], confirmed: opts.confirmed ?? false }) : undefined }),
};

export const PERMISSION_OPTIONS = [
  { value: "READ_ONLY", label: "Read-only", description: "Inspect and search only" },
  { value: "PROPOSE_ONLY", label: "Propose-only", description: "Plans and diffs, no writes" },
  { value: "EDIT_APPROVED_FILES", label: "Edit approved files", description: "Edits after per-change approval" },
  { value: "WORKSPACE_EDIT", label: "Workspace edit", description: "Create/delete files (approved)" },
  { value: "COMMAND_EXECUTION", label: "Run commands", description: "Allowlisted sandboxed commands" },
  { value: "GIT_WRITE", label: "Git write", description: "Create commits with confirmation" },
] as const;
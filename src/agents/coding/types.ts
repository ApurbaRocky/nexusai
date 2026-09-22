/**
 * Phase 6 — AI Software Engineering Agent: shared domain types.
 */

export type CodingMode =
  | "understand"
  | "plan"
  | "implement"
  | "debug"
  | "review"
  | "refactor"
  | "test"
  | "document";

export type TaskStatus =
  | "created"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "applying"
  | "testing"
  | "done"
  | "failed"
  | "cancelled";

export type PermissionLevel =
  | "READ_ONLY"
  | "PROPOSE_ONLY"
  | "EDIT_APPROVED_FILES"
  | "WORKSPACE_EDIT"
  | "COMMAND_EXECUTION"
  | "GIT_WRITE";

/** Ordered permission ladder — higher index = more power. */
export const PERMISSION_RANK: Record<PermissionLevel, number> = {
  READ_ONLY: 0,
  PROPOSE_ONLY: 1,
  EDIT_APPROVED_FILES: 2,
  WORKSPACE_EDIT: 3,
  COMMAND_EXECUTION: 4,
  GIT_WRITE: 5,
};

export function requires(level: PermissionLevel, minimum: PermissionLevel): boolean {
  return PERMISSION_RANK[level] >= PERMISSION_RANK[minimum];
}

export type ChangeStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "applied"
  | "conflict"
  | "rolled_back";

export interface CodeFileMeta {
  path: string;
  language: string;
  sizeBytes: number;
  hash: string;
  lineCount: number;
  isTest: boolean;
  isConfig: boolean;
  isDoc: boolean;
}

export interface CodeSymbolRef {
  name: string;
  kind: string;
  lineStart: number;
  lineEnd?: number;
  signature?: string;
  access?: string;
}

export interface CodeDependencyRef {
  target: string;
  isLocal: boolean;
  type: "import" | "require" | "dynamic" | "config";
  line?: number;
}

export interface CodeSearchHit {
  path: string;
  line: number;
  content: string;
  kind: "exact" | "word" | "symbol" | "semantic";
}

export interface ArchitectureReport {
  entryPoints: string[];
  files: number;
  lines: number;
  languages: Record<string, number>;
  directories: Record<string, number>;
  topDependencies: { name: string; count: number; local: boolean }[];
  unresolvedImports: { target: string; from: string }[];
}

export interface ChangePlanStep {
  step: number;
  title: string;
  detail: string;
  files?: string[];
  tool?: string;
}

export interface CodingPlanData {
  title: string;
  steps: ChangePlanStep[];
  filesAffected: string[];
  risks: { level: "low" | "medium" | "high"; notes: string[] };
}

export interface DiffOp {
  type: "context" | "add" | "del";
  oldLine?: number;
  newLine?: number;
  text: string;
}

/** Discrete edit proposed against the workspace, applied only after approval. */
export interface ProposedChange {
  path: string;
  action: "create" | "edit" | "delete" | "rename";
  newPath?: string;
  baseHash?: string;
  targetHash?: string;
  oldContent?: string;
  newContent?: string;
}

export interface TestRunCommand {
  command: string;
  label?: string;
}

export interface CommandIntent {
  command: string;
  args: string[];
  cwd?: string;
}

export interface ReviewFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  file: string;
  line?: number;
  category: string;
  title: string;
  detail: string;
  suggestion?: string;
}

export interface DebugRootCause {
  symptom: string;
  hypothesis: string;
  evidence: string[];
  affectedFile: string;
  affectedLine?: number;
  fixSuggestion: string;
}
/**
 * PermissionGuard — the workspace permission ladder for the coding agent.
 *
 * Levels (spec §15), least→most power:
 *   READ_ONLY          — default; inspect/search only
 *   PROPOSE_ONLY       — may produce plan/patch proposals, never files
 *   EDIT_APPROVED_FILES— may write a file only after explicit per-change approval
 *   WORKSPACE_EDIT     — may add/delete files within the sandbox
 *   COMMAND_EXECUTION  — may run allowlisted sandboxed commands
 *   GIT_WRITE          — may create commits (never auto-push)
 */
import { PERMISSION_RANK, requires, type PermissionLevel } from "@/agents/coding/types";

export const DEFAULT_PERMISSION: PermissionLevel = "READ_ONLY";

export function parsePermission(value: string | null | undefined): PermissionLevel {
  const v = String(value ?? "").toUpperCase().replace(/-/g, "_");
  if (PERMISSION_RANK[v as PermissionLevel] !== undefined) return v as PermissionLevel;
  return DEFAULT_PERMISSION;
}

export function canInspect(level: PermissionLevel): boolean {
  return requires(level, "READ_ONLY");
}

export function canPropose(level: PermissionLevel): boolean {
  return requires(level, "PROPOSE_ONLY");
}

export function canEditFiles(level: PermissionLevel): boolean {
  return requires(level, "EDIT_APPROVED_FILES");
}

export function canEditWorkspace(level: PermissionLevel): boolean {
  return requires(level, "WORKSPACE_EDIT");
}

export function canRunCommands(level: PermissionLevel): boolean {
  return requires(level, "COMMAND_EXECUTION");
}

export function canGitWrite(level: PermissionLevel): boolean {
  return requires(level, "GIT_WRITE");
}

export function permissionLabel(level: PermissionLevel): string {
  return level.replace(/_/g, "-").toLowerCase();
}

/** Human-readable description shown before any destructive action. */
export function permissionDescription(level: PermissionLevel): string {
  switch (level) {
    case "READ_ONLY":
      return "Read-only survey. Search, symbols, architecture and code reading only — no file writes or commands.";
    case "PROPOSE_ONLY":
      return "May propose plans, patches and diffs. Nothing is written to disk until you approve each change.";
    case "EDIT_APPROVED_FILES":
      return "May edit files, but only after you explicitly approve the exact change (with a diff preview).";
    case "WORKSPACE_EDIT":
      return "May create, edit and delete files inside the workspace sandbox after approval.";
    case "COMMAND_EXECUTION":
      return "May run allowlisted, sandboxed commands inside the workspace (npm test, node, python, git status/diff…).";
    case "GIT_WRITE":
      return "May create git commits inside the workspace with your confirmation. Never pushes or force-operates.";
  }
}
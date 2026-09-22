import { createHash } from "node:crypto";

export interface CanonicalAction {
  actionType: string;
  target: string;
  command?: string;
  workingDirectory?: string;
  arguments?: string[];
  environmentScope?: Record<string, string>;
  filePath?: string;
  oldContent?: string;
  newContent?: string;
  operation?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  [key: string]: unknown;
}

function canonicalize(action: CanonicalAction): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(action).sort()) {
    const value = action[key];
    if (value !== undefined && value !== null) {
      if (typeof value === "object") {
        sorted[key] = JSON.stringify(value, Object.keys(value).sort());
      } else {
        sorted[key] = value;
      }
    }
  }
  return JSON.stringify(sorted);
}

export function createApprovalHash(action: CanonicalAction): string {
  const canonical = canonicalize(action);
  return createHash("sha256").update(canonical).digest("hex");
}

export function verifyApprovalHash(approvalHash: string, action: CanonicalAction): boolean {
  const computedHash = createApprovalHash(action);
  return computedHash === approvalHash;
}

export function createCanonicalAction(
  actionType: string,
  target: string,
  extras: Record<string, unknown> = {}
): CanonicalAction {
  return { actionType, target, ...extras };
}

export function createFileActionCanonical(
  actionType: "CREATE" | "EDIT" | "DELETE" | "RENAME" | "MOVE",
  filePath: string,
  options: { oldContent?: string; newContent?: string; newPath?: string } = {}
): CanonicalAction {
  return createCanonicalAction(actionType, filePath, { filePath, ...options });
}

export function createCommandActionCanonical(
  command: string,
  workingDirectory: string,
  args: string[] = [],
  environmentScope: Record<string, string> = {}
): CanonicalAction {
  return createCanonicalAction("COMMAND_EXECUTION", command, {
    command,
    workingDirectory,
    arguments: args,
    environmentScope,
  });
}

export function createBrowserActionCanonical(
  actionType: string,
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): CanonicalAction {
  return createCanonicalAction(actionType, url, options);
}

export function createDatabaseActionCanonical(
  actionType: "DELETE" | "DROP" | "TRUNCATE" | "ALTER" | "BULK_UPDATE" | "BULK_DELETE",
  target: string,
  options: { query?: string; affectedCount?: number } = {}
): CanonicalAction {
  return createCanonicalAction(actionType, target, options);
}

export function createGitActionCanonical(
  actionType: "COMMIT" | "PUSH" | "RESET" | "REBASE" | "BRANCH_DELETE" | "FORCE_PUSH",
  target: string,
  options: { ref?: string; message?: string } = {}
): CanonicalAction {
  return createCanonicalAction(actionType, target, options);
}
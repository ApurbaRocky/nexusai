"use client";

import { ApprovalDialog, type ApprovalDialogProps } from "./ApprovalDialog";

export interface FileEditApprovalDialogProps extends Omit<ApprovalDialogProps, "type" | "onApprove" | "children"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (changes: FileChange[]) => void;
  onReject: () => void;
  changes: FileChange[];
  loading?: boolean;
}

export interface FileChange {
  filePath: string;
  action: "create" | "edit" | "delete" | "rename" | "move";
  additions?: number;
  deletions?: number;
  diffPreview?: string;
  newPath?: string;
}

export function FileEditApprovalDialog({
  open,
  onOpenChange,
  onApprove,
  onReject,
  changes,
  loading = false,
}: FileEditApprovalDialogProps) {
  const totalAdditions = changes.reduce((sum, c) => sum + (c.additions ?? 0), 0);
  const totalDeletions = changes.reduce((sum, c) => sum + (c.deletions ?? 0), 0);

  const actionCounts = changes.reduce((acc, c) => {
    acc[c.action] = (acc[c.action] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const actionSummary = Object.entries(actionCounts)
    .map(([action, count]) => `${count} ${action}${count > 1 ? "s" : ""}`)
    .join(", ");

  return (
    <ApprovalDialog
      open={open}
      onOpenChange={onOpenChange}
      onApprove={() => onApprove(changes)}
      onReject={onReject}
      type="file_edit"
      title={`Modify ${changes.length} file${changes.length > 1 ? "s" : ""}`}
      description={actionSummary}
      details={{
        Files: changes.length.toString(),
        "Lines Added": `+${totalAdditions}`,
        "Lines Removed": `-${totalDeletions}`,
        Actions: actionSummary,
      }}
      riskLevel={changes.some((c) => c.action === "delete") ? "HIGH" : "MEDIUM"}
      exactAction={{ changes: changes.map((c) => ({ filePath: c.filePath, action: c.action })) }}
      showExactAction={true}
      loading={loading}
    />
  );
}
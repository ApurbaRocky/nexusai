"use client";

import { useState } from "react";
import { ApprovalDialog, ApprovalDialogProps } from "./ApprovalDialog";

export interface DeleteApprovalDialogProps extends Omit<ApprovalDialogProps, "type" | "onApprove" | "children"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (paths: string[]) => void;
  onReject: () => void;
  paths: string[];
  reason?: string;
  loading?: boolean;
}

export function DeleteApprovalDialog({
  open,
  onOpenChange,
  onApprove,
  onReject,
  paths,
  reason,
  loading = false,
}: DeleteApprovalDialogProps) {
  const [showAll, setShowAll] = useState(false);
  const remaining = paths.length - 5;

  return (
    <ApprovalDialog
      open={open}
      onOpenChange={onOpenChange}
      onApprove={() => onApprove(paths)}
      onReject={onReject}
      type="delete"
      title={`Delete ${paths.length} item${paths.length > 1 ? "s" : ""}`}
      description={reason || `Permanently delete ${paths.length} file${paths.length > 1 ? "s" : ""}`}
      details={
        paths.length <= 5
          ? paths.reduce((acc, p, i) => ({ ...acc, [`File ${i + 1}`]: p }), {})
          : {
              ...paths.slice(0, 5).reduce((acc, p, i) => ({ ...acc, [`File ${i + 1}`]: p }), {}),
              ...(remaining > 0 && { [`+${remaining} more`]: "" }),
            }
      }
      riskLevel="HIGH"
      loading={loading}
    >
      {paths.length > 5 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-sm text-primary hover:underline"
          >
            {showAll ? "Show less" : `Show all ${paths.length} files`}
          </button>
        </div>
      )}
    </ApprovalDialog>
  );
}
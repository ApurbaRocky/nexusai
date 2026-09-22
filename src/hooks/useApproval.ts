"use client";

import { useState, useCallback } from "react";
import { ApprovalDialogProps } from "@/components/governance";

export interface UseApprovalReturn {
  approvalState: ApprovalDialogProps | null;
  requestApproval: (config: ApprovalDialogProps) => Promise<boolean>;
  closeApproval: () => void;
}

export function useApproval(): UseApprovalReturn {
  const [approvalState, setApprovalState] = useState<ApprovalDialogProps | null>(null);

  const requestApproval = useCallback(
    (config: ApprovalDialogProps): Promise<boolean> => {
      return new Promise((resolve) => {
        setApprovalState({
          ...config,
          open: true,
          onOpenChange: (open) => {
            if (!open) {
              setApprovalState(null);
              resolve(false);
            }
          },
          onApprove: (exactAction) => {
            setApprovalState(null);
            config.onApprove(exactAction);
            resolve(true);
          },
          onReject: () => {
            setApprovalState(null);
            config.onReject();
            resolve(false);
          },
        });
      });
    },
    []
  );

  const closeApproval = useCallback(() => {
    setApprovalState(null);
  }, []);

  return { approvalState, requestApproval, closeApproval };
}

export function useDeleteApproval() {
  const { approvalState, requestApproval, closeApproval } = useApproval();

  const requestDeleteApproval = useCallback(
    (paths: string[], reason?: string) =>
      requestApproval({
        type: "delete",
        title: `Delete ${paths.length} item${paths.length > 1 ? "s" : ""}`,
        description: reason || `Permanently delete ${paths.length} file${paths.length > 1 ? "s" : ""}`,
        details: paths.reduce((acc, p, i) => ({ ...acc, [`File ${i + 1}`]: p }), {}),
        riskLevel: "HIGH",
        onApprove: () => {},
        onReject: () => {},
        open: false,
        onOpenChange: () => {},
      }),
    [requestApproval]
  );

  return { approvalState, requestDeleteApproval, closeApproval };
}

export function useCommandApproval() {
  const { approvalState, requestApproval, closeApproval } = useApproval();

  const requestCommandApproval = useCallback(
    (command: string, workingDirectory: string, args?: string[], reason?: string) =>
      requestApproval({
        type: "execute",
        title: "Execute Command",
        description: reason || `Run command in ${workingDirectory}`,
        details: {
          Command: args?.length ? `${command} ${args.join(" ")}` : command,
          Directory: workingDirectory,
        },
        riskLevel: "HIGH",
        exactAction: { command, workingDirectory, arguments: args },
        showExactAction: true,
        onApprove: () => {},
        onReject: () => {},
        open: false,
        onOpenChange: () => {},
      }),
    [requestApproval]
  );

  return { approvalState, requestCommandApproval, closeApproval };
}

export function useFileEditApproval() {
  const { approvalState, requestApproval, closeApproval } = useApproval();

  const requestFileEditApproval = useCallback(
    (changes: Array<{ filePath: string; action: string; additions?: number; deletions?: number }>) =>
      requestApproval({
        type: "file_edit",
        title: `Modify ${changes.length} file${changes.length > 1 ? "s" : ""}`,
        description: changes.map((c) => `${c.action} ${c.filePath}`).join(", "),
        details: {
          Files: changes.length.toString(),
          "Lines Added": `+${changes.reduce((sum, c) => sum + (c.additions ?? 0), 0)}`,
          "Lines Removed": `-${changes.reduce((sum, c) => sum + (c.deletions ?? 0), 0)}`,
        },
        riskLevel: changes.some((c) => c.action === "delete") ? "HIGH" : "MEDIUM",
        exactAction: { changes },
        showExactAction: true,
        onApprove: () => {},
        onReject: () => {},
        open: false,
        onOpenChange: () => {},
      }),
    [requestApproval]
  );

  return { approvalState, requestFileEditApproval, closeApproval };
}
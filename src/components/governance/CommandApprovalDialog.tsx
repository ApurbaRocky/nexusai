"use client";

import { ApprovalDialog, type ApprovalDialogProps } from "./ApprovalDialog";

export interface CommandApprovalDialogProps extends Omit<ApprovalDialogProps, "type" | "onApprove" | "children"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (command: string, workingDir: string, args?: string[]) => void;
  onReject: () => void;
  command: string;
  workingDirectory: string;
  args?: string[];
  reason?: string;
  loading?: boolean;
}

export function CommandApprovalDialog({
  open,
  onOpenChange,
  onApprove,
  onReject,
  command,
  workingDirectory,
  args,
  reason,
  loading = false,
}: CommandApprovalDialogProps) {
  const fullCommand = args?.length ? `${command} ${args.join(" ")}` : command;

  return (
    <ApprovalDialog
      open={open}
      onOpenChange={onOpenChange}
      onApprove={() => onApprove(command, workingDirectory, args)}
      onReject={onReject}
      type="execute"
      title="Execute Command"
      description={reason || `Run command in ${workingDirectory}`}
      details={{
        Command: fullCommand,
        Directory: workingDirectory,
        ...(args?.length && { Arguments: args.join(" ") }),
      }}
      riskLevel="HIGH"
      exactAction={{ command, workingDirectory, arguments: args }}
      showExactAction={true}
      loading={loading}
    />
  );
}
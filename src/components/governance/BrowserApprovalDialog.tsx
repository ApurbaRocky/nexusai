"use client";

import { ApprovalDialog, type ApprovalDialogProps } from "./ApprovalDialog";

export interface BrowserApprovalDialogProps extends Omit<ApprovalDialogProps, "type" | "onApprove" | "children"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (action: BrowserAction) => void;
  onReject: () => void;
  action: BrowserAction;
  loading?: boolean;
}

export interface BrowserAction {
  type: string;
  url: string;
  description: string;
  method?: string;
  dataInvolved?: Record<string, unknown>;
  possibleConsequences?: string[];
}

export function BrowserApprovalDialog({
  open,
  onOpenChange,
  onApprove,
  onReject,
  action,
  loading = false,
}: BrowserApprovalDialogProps) {
  const isDestructive = ["DELETE", "SUBMIT_FORM", "SEND_MESSAGE", "PUBLISH", "PURCHASE", "CHANGE_SETTING"].includes(action.type.toUpperCase());

  return (
    <ApprovalDialog
      open={open}
      onOpenChange={onOpenChange}
      onApprove={() => onApprove(action)}
      onReject={onReject}
      type="browser"
      title={`Browser: ${action.type}`}
      description={action.description}
      details={{
        Action: action.type,
        URL: action.url,
        ...(action.method && { Method: action.method }),
        ...(action.dataInvolved && { "Data Fields": Object.keys(action.dataInvolved).join(", ") }),
      }}
      riskLevel={isDestructive ? "HIGH" : "MEDIUM"}
      exactAction={action}
      showExactAction={true}
      loading={loading}
    >
      {action.possibleConsequences?.length && (
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm font-medium text-amber-800 mb-1">Possible Consequences:</p>
          <ul className="text-sm text-amber-700 space-y-1">
            {action.possibleConsequences.map((c, i) => (
              <li key={i} className="flex items-start gap-1">
                <span>•</span> {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ApprovalDialog>
  );
}
"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FileText, Terminal, Globe, GitBranch, Database, Shield, CreditCard, Key } from "lucide-react";
import { cn } from "@/lib/utils";

export type ApprovalType = "delete" | "execute" | "file_edit" | "browser" | "git" | "database" | "deployment" | "financial" | "security";

export interface ApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (exactAction?: unknown) => void;
  onReject: () => void;
  type: ApprovalType;
  title: string;
  description: string;
  details: Record<string, unknown>;
  children?: ReactNode;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  showExactAction?: boolean;
  exactAction?: unknown;
  loading?: boolean;
}

const typeIcons: Record<ApprovalType, typeof AlertTriangle> = {
  delete: AlertTriangle,
  execute: Terminal,
  file_edit: FileText,
  browser: Globe,
  git: GitBranch,
  database: Database,
  deployment: Shield,
  financial: CreditCard,
  security: Key,
};

const typeLabels: Record<ApprovalType, string> = {
  delete: "Deletion",
  execute: "Command Execution",
  file_edit: "File Modification",
  browser: "Browser Action",
  git: "Git Operation",
  database: "Database Operation",
  deployment: "Deployment",
  financial: "Financial Transaction",
  security: "Security Change",
};

const riskColors: Record<ApprovalDialogProps["riskLevel"], string> = {
  LOW: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function formatDetail(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) ?? "" : String(value);
}

export function ApprovalDialog({
  open,
  onOpenChange,
  onApprove,
  onReject,
  type,
  title,
  description,
  details,
  children,
  riskLevel,
  showExactAction = false,
  exactAction,
  loading = false,
}: ApprovalDialogProps) {
  const [showDetails, setShowDetails] = useState(false);
  const Icon = typeIcons[type];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <DialogTitle className="text-lg">Approval Required</DialogTitle>
          </div>
          <DialogDescription>{typeLabels[type]}: {title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
            <Icon className="h-6 w-6 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{description}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className={cn("px-2 py-0.5 text-xs font-medium rounded-full", riskColors[riskLevel])}>{riskLevel} RISK</span>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {Object.entries(details).map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 text-sm">
                <span className="font-medium text-muted-foreground w-24 flex-shrink-0">{key}:</span>
                <span className="font-mono text-xs break-all">{formatDetail(value)}</span>
              </div>
            ))}
          </div>
          {children}
          {showExactAction && exactAction !== undefined && exactAction !== null && (
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">Exact Action (for verification)</span>
                <Button variant="ghost" size="sm" onClick={() => setShowDetails(!showDetails)} className="text-xs">{showDetails ? "Hide" : "Show"} Details</Button>
              </div>
              {showDetails && <div className="bg-muted p-3 rounded font-mono text-xs overflow-x-auto max-h-60"><pre>{formatDetail(exactAction)}</pre></div>}
            </div>
          )}
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-sm text-destructive"><strong>Warning:</strong> This action cannot be automatically reversed. Please review carefully before approving.</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onReject} disabled={loading}>Reject</Button>
          <Button variant="destructive" onClick={() => onApprove(exactAction)} disabled={loading} className="bg-destructive hover:bg-destructive/90">{loading ? "Approving..." : "Approve"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

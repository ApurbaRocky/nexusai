import type { Metadata } from "next";
import { WorkspaceClient } from "./workspace-client";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Coding workspace" };

export default function CodingWorkspacePage() {
  return (
    <Suspense fallback={<div className="px-8 py-8 text-sm text-muted-foreground">Loading workspace…</div>}>
      <WorkspaceClient />
    </Suspense>
  );
}
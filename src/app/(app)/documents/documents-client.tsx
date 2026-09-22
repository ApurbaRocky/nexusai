"use client";

import * as React from "react";
import { api, type DocRow, type ProjectSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileText, Loader2, Trash2, UploadCloud } from "lucide-react";
import { Markdown } from "@/components/markdown/markdown";

const ACCEPT = [".txt,.md,.csv,.json", ".pdf", ".docx", ".pptx", ".xlsx", ".png,.jpg,.jpeg"].join(",");

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function DocumentsClient() {
  const [docs, setDocs] = React.useState<DocRow[] | null>(null);
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = React.useState<string>("");
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [detail, setDetail] = React.useState<(DocRow & { textPreview: string; chunkCount: number; error?: string | null }) | null>(null);

  const refresh = async () => {
    const res = await fetch("/api/documents");
    const data = await res.json().catch(() => ({ documents: [] }));
    return (data as { documents: DocRow[] }).documents;
  };

  React.useEffect(() => {
    refresh().then(setDocs).catch(() => setDocs([]));
    api.projects().then((r) => setProjects(r.projects)).catch(() => {});
  }, []);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0;
    let failed = 0;
    for (const file of Array.from(files)) {
      try {
        await api.uploadDocument(file, projectId || null);
        ok++;
      } catch (err) {
        failed++;
        toast.error((err as Error).message);
      }
    }
    if (ok) toast.success(`${ok} document${ok > 1 ? "s" : ""} uploaded and indexed`);
    if (failed && ok === 0) toast.error("Upload failed");
    setUploading(false);
    setDragOver(false);
    await refresh();
  };

  const remove = async (id: string) => {
    try {
      await api.deleteDocument(id);
      toast.success("Document removed");
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">Upload documents for the knowledge base. They are indexed for retrieval and secure Q&A.</p>
        </div>

        <div
          className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            void upload(e.dataTransfer.files);
          }}
        >
          <UploadCloud className="size-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Drop files here, or</p>
            <p className="text-xs text-muted-foreground">TXT, MD, CSV, JSON, PDF, DOCX, PPTX, XLSX and images · 25 MB max each</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">No project (global knowledge)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : "Choose files"}
            </Button>
          </div>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden className="hidden" onChange={(e) => void upload(e.target.files)} />
        </div>

        {uploading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Indexing…
          </p>
        )}

        <h2 className="text-sm font-semibold">{docs === null ? "Loading…" : `${docs.length} document${docs.length === 1 ? "" : "s"}`}</h2>

        {docs === null ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : docs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <FileText className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">No documents yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border bg-background px-4 py-2.5">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <button className="min-w-0 flex-1 text-left" onClick={() => api.document(d.id).then((res) => setDetail(res.document)).catch(() => toast.error("Could not load document"))}>
                  <p className="truncate text-sm font-medium">{d.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.mimeType ?? "unknown"} · {formatBytes(d.sizeBytes)} · {new Date(d.createdAt).toLocaleDateString()}
                  </p>
                </button>
                <Badge variant={d.status === "ready" ? "secondary" : d.status === "indexed" ? "outline" : "outline"}>{d.status}</Badge>
                <Button variant="ghost" size="icon" onClick={() => remove(d.id)} aria-label="Delete document">
                  <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
          <DialogContent className="max-w-2xl">
            {detail && (
              <>
                <DialogHeader>
                  <DialogTitle>{detail.filename}</DialogTitle>
                  <DialogDescription>
                    {detail.mimeType ?? "unknown"} · {detail.chunkCount} chunks indexed · status: {detail.status}
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[50vh]">
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <Markdown>{detail.textPreview || "No extractable text preview. Try a supported format."}</Markdown>
                  </div>
                  {detail.error && <p className="mt-2 text-xs text-destructive">{detail.error}</p>}
                </ScrollArea>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}
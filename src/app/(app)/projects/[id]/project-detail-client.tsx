"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type DocRow, type ProjectDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, FileText, FolderOpen, Loader2, MessageSquare, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface DetailData {
  project: ProjectDetail;
  documents: DocRow[];
  conversations: { id: string; title: string; updatedAt: string }[];
  memories: { id: string; content: string; type: string }[];
  reportCount: number;
}

export function ProjectDetailClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = React.useState<DetailData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.project(projectId).then(setData).catch(() => setError("Project not found."));
  }, [projectId]);

  React.useEffect(load, [load]);

  const remove = async () => {
    try {
      await api.deleteProject(projectId);
      toast.success("Project deleted");
      router.push("/projects");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Link href="/projects" className="mt-3 inline-block text-sm underline underline-offset-4">
          Back to projects
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <div className="space-y-3">
          <button onClick={() => router.push("/projects")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Projects
          </button>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <FolderOpen className="size-5" /> {data.project.name}
              </h1>
              <p className="text-sm text-muted-foreground">{data.project.description || "No description"}</p>
            </div>
            <Dialog>
              <DialogTrigger render={<Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="Delete project"><Trash2 className="size-4 hover:text-destructive" /></Button>}>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Delete “{data.project.name}”?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">This removes the project and its scoped metadata. Chats and documents remain accessible outside the project.</p>
                <DialogFooter>
                  <Button variant="destructive" onClick={remove} autoFocus>
                    Delete project
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MiniStat label="Conversations" value={data.conversations.length} />
          <MiniStat label="Documents" value={data.documents.length} />
          <MiniStat label="Reports" value={data.reportCount} />
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Chats</h2>
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                const c = await api.createConversation({ title: `${data.project.name} chat`, projectId });
                router.push(`/chat/${c.id}`);
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}>
              <Plus className="size-3.5" /> New chat
            </Button>
          </div>
          {data.conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No chats in this project yet.</p>
          ) : (
            <div className="grid gap-2">
              {data.conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/chat/${c.id}`)}
                  className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/40"
                >
                  <MessageSquare className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{c.title || "Untitled chat"}</span>
                  <span className="text-[11px] text-muted-foreground">{new Date(c.updatedAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Documents</h2>
          {data.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents yet — upload from the Documents page.</p>
          ) : (
            <div className="grid gap-2">
              {data.documents.map((d) => (
                <div key={d.id} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{d.filename}</span>
                  <Badge variant="secondary">{d.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Memories</h2>
          {data.memories.length === 0 ? (
            <p className="text-sm text-muted-foreground">None recorded for this project.</p>
          ) : (
            <div className="grid gap-2">
              {data.memories.map((m) => (
                <div key={m.id} className="rounded-lg border bg-background px-3 py-2">
                  <Badge variant="secondary" className="mb-1 text-[10px]">{m.type}</Badge>
                  <p className="text-sm">{m.content}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* File intelligence placeholder — real document Q&A arrives with the RAG pipeline wired into chat. */}
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription>Project file intelligence (ask your documents) is a scheduled capability — it attaches when RAG is enabled for a model.</AlertDescription>
        </Alert>
      </div>
    </ScrollArea>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="py-4 text-center">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
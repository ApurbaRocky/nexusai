"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { api, type ProjectSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FolderKanban, Loader2, MessageSquare, Plus, FileText } from "lucide-react";

export function ProjectsClient() {
  const router = useRouter();
  const [projects, setProjects] = React.useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const load = React.useCallback(() => {
    api.projects().then((r) => setProjects(r.projects)).catch(() => setProjects([]));
  }, []);

  React.useEffect(load, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await api.createProject({ name: name.trim(), description: description.trim() || undefined });
      toast.success("Project created");
      setDialogOpen(false);
      setName("");
      setDescription("");
      router.push(`/projects/${res.project.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 md:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Scoped workspaces with their own chats, documents and knowledge base.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button><Plus className="size-4" /> New project</Button>}>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription>Name it and give it a short description. You can attach chats, documents and research later.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="p-name">Name</Label>
                <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 research sprint" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-desc">Description (optional)</Label>
                <Textarea id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this project is about" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={create} disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {projects === null ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <FolderKanban className="size-9 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">No projects yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <Card key={p.id} className="transition-shadow hover:shadow-md" onClick={() => router.push(`/projects/${p.id}`)} role="button" tabIndex={0}>
              <CardHeader className="cursor-pointer">
                <CardTitle className="text-base">{p.name}</CardTitle>
                <CardDescription className="line-clamp-2">{p.description || "No description"}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MessageSquare className="size-3.5" /> {p.conversationCount} chats
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="size-3.5" /> {p.documentCount} documents
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
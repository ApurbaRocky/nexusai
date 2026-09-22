"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { codingApi, type CodingWorkspaceListItem } from "@/lib/coding-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ArrowRight, Code2, Loader2, Plus, Upload, FileArchive } from "lucide-react";

export function CodingClient() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = React.useState<CodingWorkspaceListItem[] | null>(null);
  const [open, setOpen] = React.useState(false);

  const load = React.useCallback(() => {
    codingApi.list().then((r) => setWorkspaces(r.workspaces)).catch(() => setWorkspaces([]));
  }, []);

  React.useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Coding workspaces</h1>
          <p className="text-sm text-muted-foreground">Import a repository ZIP, inspect it, plan + approve changes, run tests and track everything.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" /> New workspace
        </Button>
      </div>

      <CreateDialog open={open} onOpenChange={setOpen} onCreate={(id) => router.push(`/coding/${id}`)} />

      {workspaces === null ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading workspaces…
        </div>
      ) : workspaces.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Code2 className="size-9 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">No workspace yet. Create one to start analyzing a codebase.</p>
            <Button variant="outline" className="mt-1" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Create workspace
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((w) => (
            <Card key={w.id} className="transition-shadow hover:shadow-md" role="button" tabIndex={0} onClick={() => router.push(`/coding/${w.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/coding/${w.id}`)}>
              <CardHeader className="cursor-pointer">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{w.name}</CardTitle>
                  <Badge variant={w.status === "ready" ? "default" : w.status === "indexing" ? "secondary" : "destructive"}>{w.status}</Badge>
                </div>
                <CardDescription className="line-clamp-2">{w.description || `${w._count?.files ?? 0} indexed files · ${w.language ?? "no language yet"}`}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ArchiveIcon /> {w._count?.files ?? 0} files
                </span>
                <span className="flex items-center gap-1">{w._count?.tasks ?? 0} tasks</span>
                <span className="flex items-center gap-1">{w._count?.changes ?? 0} changes</span>
                {w.permissionLevel && <span className="ml-auto font-medium text-muted-foreground">{w.permissionLevel}</span>}
                <ArrowRight className="size-3.5" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ArchiveIcon() {
  return <FileArchive className="size-3.5" />;
}

function CreateDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (v: boolean) => void; onCreate: (id: string) => void }) {
  const [tab, setTab] = React.useState<"zip" | "empty">("zip");
  const [name, setName] = React.useState("");
  const [zip, setZip] = React.useState<File | null>(null);
  const [gitInit, setGitInit] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const reset = () => {
    setName("");
    setZip(null);
    setGitInit(false);
  };

  const create = async () => {
    if (!name.trim()) return toast.error("Give the workspace a name.");
    setBusy(true);
    try {
      let res;
      if (tab === "zip") {
        if (!zip) return toast.error("Choose a repository ZIP to import.");
        res = await codingApi.createZip(zip, { name: name.trim(), gitInit });
        toast.success(`Imported ${res.imported} files.`);
      } else {
        res = await codingApi.createJson({ name: name.trim(), sourceType: "empty", gitInit });
        toast.success("Empty workspace created.");
      }
      reset();
      onOpenChange(false);
      onCreate(res.workspace.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create coding workspace</DialogTitle>
          <DialogDescription>Import an existing repository (ZIP) or start empty. Files are sandboxed to their own directory.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "zip" | "empty")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="zip">
              <Upload className="mr-1.5 size-3.5" /> Import ZIP
            </TabsTrigger>
            <TabsTrigger value="empty">Empty</TabsTrigger>
          </TabsList>

          <TabsContent value="zip" className="grid gap-3 pt-2">
            <div className="grid gap-1.5">
              <Label htmlFor="w-name">Name</Label>
              <Input id="w-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-repository" />
            </div>
            <div className="grid gap-1.5">
              <Label>Repository ZIP</Label>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground">
                <FileArchive className="size-6" />
                {zip ? <span className="font-medium text-foreground">{zip.name}</span> : <span>Click to choose a .zip snapshot of your repository</span>}
                <input type="file" accept=".zip" className="hidden" onChange={(e) => setZip(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch id="w-git" checked={gitInit} onCheckedChange={setGitInit} />
              <Label htmlFor="w-git" className="text-sm font-normal">git init (creates a repo so commits can be tracked)</Label>
            </div>
          </TabsContent>

          <TabsContent value="empty" className="grid gap-3 pt-2">
            <div className="grid gap-1.5">
              <Label htmlFor="w-name2">Name</Label>
              <Input id="w-name2" value={name} onChange={(e) => setName(e.target.value)} placeholder="scratch-project" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="w-git2" checked={gitInit} onCheckedChange={setGitInit} />
              <Label htmlFor="w-git2" className="text-sm font-normal">git init</Label>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button onClick={create} disabled={busy}>
            {busy ? <><Loader2 className="mr-1.5 size-4 animate-spin" /> Creating…</> : "Create workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
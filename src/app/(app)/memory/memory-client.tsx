"use client";

import * as React from "react";
import { api, type MemoryItem } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Brain, Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const TYPES = ["preference", "fact", "project", "goal", "note"] as const;

export function MemoryClient() {
  const [items, setItems] = React.useState<MemoryItem[] | null>(null);
  const [filter, setFilter] = React.useState<string>("all");
  const [creating, setCreating] = React.useState(false);
  const [newContent, setNewContent] = React.useState("");
  const [newType, setNewType] = React.useState<string>("note");
  const [editing, setEditing] = React.useState<MemoryItem | null>(null);

  const load = React.useCallback(() => {
    api.memories().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);

  React.useEffect(load, [load]);

  const submit = async () => {
    if (!newContent.trim()) return;
    setCreating(true);
    try {
      await api.createMemory({ content: newContent.trim(), type: newType });
      toast.success("Memory saved");
      setNewContent("");
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (item: MemoryItem) => {
    await api.updateMemory(item.id, { enabled: !item.enabled }).catch(() => {});
    setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, enabled: !item.enabled } : i)) ?? null);
  };

  const remove = async (item: MemoryItem) => {
    await api.deleteMemory(item.id).catch(() => {});
    setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? null);
    toast.success("Memory deleted");
  };

  const saveEdit = async (content: string, type: string) => {
    if (!editing) return;
    await api.updateMemory(editing.id, { content, type }).catch(() => {});
    setEditing(null);
    setItems((prev) => prev?.map((i) => (i.id === editing.id ? { ...i, content, type } : i)) ?? null);
    toast.success("Memory updated");
  };

  const filtered = items?.filter((i) => filter === "all" || i.type === filter) ?? null;

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Memory</h1>
          <p className="text-sm text-muted-foreground">Long-term context the agents will recall in future conversations. Memorized facts are injected as context and redacted where sensitive.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a memory</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder={"e.g. The user prefers concise answers and Python for data work. Avatar colors: teal."} rows={2} />
              <div className="flex items-center justify-between gap-2">
                <Select value={newType} onValueChange={(v) => v && setNewType(v)}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={submit} disabled={creating || !newContent.trim()}>
                  <Plus className="size-4" /> Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {items === null ? "Loading…" : `${filtered?.length ?? 0} memory entries`}
          </h2>
          <Select value={filter} onValueChange={(v) => v && setFilter(v)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtered === null ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading memories…
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Brain className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">No memories yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2">
            {filtered.map((item) => (
              <div key={item.id} className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3">
                <Button variant={item.enabled ? "default" : "outline"} size="icon" className="size-8 shrink-0" onClick={() => toggle(item)} aria-label="Toggle enabled">
                  <Power className="size-3.5" />
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {item.type}
                    </Badge>
                    {item.source && <span className="text-[11px] text-muted-foreground">via {item.source}</span>}
                    {!item.enabled && <span className="text-[11px] text-muted-foreground">disabled</span>}
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{item.content}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <EditDialog item={editing === item ? editing : item} onSave={saveEdit}>
                    <Button variant="ghost" size="icon" onClick={() => setEditing(item)} aria-label="Edit">
                      <Pencil className="size-4" />
                    </Button>
                  </EditDialog>
                  <Button variant="ghost" size="icon" onClick={() => remove(item)} aria-label="Delete">
                    <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function EditDialog({ item, onSave, children }: { item: MemoryItem; onSave: (content: string, type: string) => void; children: React.ReactNode }) {
  const [content, setContent] = React.useState(item.content);
  const [type, setType] = React.useState(item.type);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setContent(item.content);
          setType(item.type);
        }
      }}
    >
      <DialogTrigger render={<>{children}</>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit memory</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
          <Select value={type} onValueChange={(v) => v && setType(v)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onSave(content, type);
            }}
            disabled={!content.trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
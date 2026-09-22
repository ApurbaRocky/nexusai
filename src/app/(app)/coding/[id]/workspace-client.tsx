"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { codingApi, PERMISSION_OPTIONS, type ArchitectureReportRow, type CodingChangeRow, type CodingFileRow, type CodingTaskLite, type CodingWorkspaceDetail, type SearchHit } from "@/lib/coding-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  FileCode,
  GitBranch,
  Hammer,
  History,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  Wand2,
  XCircle,
} from "lucide-react";

const SEARCH_MODES = ["auto", "exact", "word", "symbol", "semantic"] as const;

export function WorkspaceClient() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [detail, setDetail] = React.useState<CodingWorkspaceDetail | null>(null);
  const [arch, setArch] = React.useState<ArchitectureReportRow | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const [d, a] = await Promise.all([codingApi.detail(id), codingApi.architecture(id).catch(() => null)]);
    setDetail(d);
    setArch(a);
  }, [id]);

  React.useEffect(() => {
    load().catch((e) => toast.error((e as Error).message));
  }, [load]);

  if (!detail || !detail.workspace) {
    return (
      <div className="flex items-center gap-2 px-8 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading workspace…
      </div>
    );
  }

  const relayout = () => setTimeout(() => window.dispatchEvent(new Event("resize")), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push("/coding")}>
            <ArrowLeft className="mr-1 size-3.5" /> Coding
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">{detail.workspace.name}</h1>
          <p className="text-sm text-muted-foreground">
            {detail.workspace.description || `${detail.workspace.language ?? "no language"} · ${detail.workspace.framework ?? "no framework detected"}`}
            {detail.workspace.lastIndexedAt ? ` · indexed ${new Date(detail.workspace.lastIndexedAt).toLocaleString()}` : " · not indexed yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { const r = await codingApi.index(id); toast.success(`Indexed ${r.files} files (${r.symbols} symbols)`); await load(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); relayout(); } }}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Index
          </Button>
          <Button variant="ghost" size="icon" className="text-destructive" onClick={async () => { if (!confirm("Delete this workspace and its files?")) return; await codingApi.remove(id).catch((e) => toast.error((e as Error).message)); router.push("/coding"); }}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {detail.workspace.indexError && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
            <XCircle className="size-4" /> Index error: {detail.workspace.indexError}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview" onValueChange={relayout}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview"><ShieldCheck className="mr-1.5 size-3.5" /> Overview</TabsTrigger>
          <TabsTrigger value="explore"><Search className="mr-1.5 size-3.5" /> Explore</TabsTrigger>
          <TabsTrigger value="ask"><Bot className="mr-1.5 size-3.5" /> Ask</TabsTrigger>
          <TabsTrigger value="changes"><Wand2 className="mr-1.5 size-3.5" /> Plan &amp; Changes</TabsTrigger>
          <TabsTrigger value="review"><CheckCircle2 className="mr-1.5 size-3.5" /> Review &amp; Fix</TabsTrigger>
          <TabsTrigger value="run"><Terminal className="mr-1.5 size-3.5" /> Run &amp; Git</TabsTrigger>
          <TabsTrigger value="activity"><History className="mr-1.5 size-3.5" /> Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab id={id} detail={detail} arch={arch} onChanged={load} />
        </TabsContent>
        <TabsContent value="explore">
          <ExploreTab id={id} files={detail.files} />
        </TabsContent>
        <TabsContent value="ask">
          <AskTab id={id} />
        </TabsContent>
        <TabsContent value="changes">
          <ChangesTab id={id} />
        </TabsContent>
        <TabsContent value="review">
          <ReviewTab id={id} />
        </TabsContent>
        <TabsContent value="run">
          <RunTab id={id} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab id={id} detail={detail} onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ----------------------------- Overview -----------------------------

function OverviewTab({ id, detail, arch, onChanged }: { id: string; detail: CodingWorkspaceDetail; arch: ArchitectureReportRow | null; onChanged: () => void }) {
  const [level, setLevel] = React.useState(detail.workspace.permissionLevel);
  const [savingPerm, setSavingPerm] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState<CodingFileRow | null>(null);
  const [fileContent, setFileContent] = React.useState<string | null>(null);
  const [symbols, setSymbols] = React.useState<{ id: string; name: string; kind: string; lineStart: number; signature: string | null; access: string | null }[] | null>(null);

  React.useEffect(() => setLevel(detail.workspace.permissionLevel), [detail.workspace.permissionLevel]);

  const openFile = async (f: CodingFileRow) => {
    setSelectedFile(f);
    setFileContent(null);
    setSymbols(null);
    const [fc, syms] = await Promise.all([codingApi.file(id, f.path), codingApi.symbols(id, { file: f.path })]);
    setFileContent(fc.content);
    setSymbols(syms);
  };

  const savePerm = async () => {
    if (level === detail.workspace.permissionLevel) return;
    setSavingPerm(true);
    try {
      await codingApi.patch(id, { permissionLevel: level });
      toast.success(`Permission set to ${level}.`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingPerm(false);
    }
  };

  const allFiles = [...detail.files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Repository snapshot</CardTitle>
            <CardDescription>Indexed files, languages and entry points.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {arch && (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border p-2"><p className="text-lg font-semibold">{arch.files}</p><p className="text-[11px] text-muted-foreground">files</p></div>
                  <div className="rounded-lg border p-2"><p className="text-lg font-semibold">{arch.lines.toLocaleString()}</p><p className="text-[11px] text-muted-foreground">lines</p></div>
                  <div className="rounded-lg border p-2"><p className="text-lg font-semibold">{Object.keys(arch.languages).length}</p><p className="text-[11px] text-muted-foreground">languages</p></div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Languages</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(arch.languages).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([lang, n]) => (
                      <Badge key={lang} variant="secondary">{lang} · {n}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Entry points</p>
                  <pre className="rounded-md bg-muted p-2 text-xs">{arch.entryPoints.join("\n") || "none"}</pre>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Top dependencies</p>
                  <p className="text-sm text-muted-foreground">{arch.topDependencies.slice(0, 6).map((d) => `${d.name} (${d.count})`).join(", ") || "none"}</p>
                </div>
                {arch.unresolvedImports.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Unresolved imports</p>
                    <p className="text-sm text-muted-foreground">{arch.unresolvedImports.slice(0, 5).map((i) => i.target).join(", ")}</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Permission level</CardTitle>
            <CardDescription>What the coding agent is allowed to do in this sandbox.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={level} onValueChange={(v) => setLevel(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a level" />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{PERMISSION_OPTIONS.find((o) => o.value === level)?.description}</p>
            <Button size="sm" onClick={savePerm} disabled={savingPerm || level === detail.workspace.permissionLevel}>
              {savingPerm ? <Loader2 className="size-3.5 animate-spin" /> : "Save permission"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Files</CardTitle>
            <CardDescription>{allFiles.length} indexed files. Click to preview.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-72">
              <div className="px-3 pb-3">
                {allFiles.map((f) => (
                  <button key={f.id} onClick={() => openFile(f)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" title={f.path}>
                    <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.path}</span>
                    {f.isTest && <Badge variant="outline" className="h-4 px-1 text-[10px]">test</Badge>}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-3">
        <Card className="h-full min-h-[420px]">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Braces className="size-4" /> File: {selectedFile?.path ?? "—"}</CardTitle>
            {selectedFile && <CardDescription>{selectedFile.language} · {selectedFile.lineCount} lines · {selectedFile.sizeBytes} bytes</CardDescription>}
          </CardHeader>
          <CardContent>
            {fileContent === null ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Select a file to preview its content.</p>
            ) : (
              <ScrollArea className="h-[620px]">
                <pre className="rounded-md bg-muted/60 p-3 text-xs leading-5">{fileContent}</pre>
              </ScrollArea>
            )}
          </CardContent>
          {symbols && symbols.length > 0 && (
            <CardContent className="border-t pt-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Symbols in this file ({symbols.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {symbols.slice(0, 40).map((s) => (
                  <Badge key={`${s.name}:${s.lineStart}`} variant="secondary">{s.kind} {s.name}:{s.lineStart}</Badge>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

// ----------------------------- Explore -----------------------------

function ExploreTab({ id, files }: { id: string; files: CodingFileRow[] }) {
  const [query, setQuery] = React.useState("");
  const [mode, setMode] = React.useState<(typeof SEARCH_MODES)[number]>("auto");
  const [hits, setHits] = React.useState<SearchHit[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [symbolSig, setSymbolSig] = React.useState<string | null>(null);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      if (mode === "symbol") {
        const syms = await codingApi.symbols(id, { q: query });
        setHits(syms.map((s) => ({ path: s.file.path, line: s.lineStart, content: `${s.kind} ${s.name}`, kind: "symbol" })));
      } else {
        setHits(await codingApi.search(id, query, mode));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = async (pth: string) => {
    setSymbolSig(null);
    try {
      const f = await codingApi.file(id, pth);
      setSymbolSig(`## ${pth}\n\n\`\`\`\n${cut(f.content, 8000)}\n\`\`\``);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Search the codebase</CardTitle>
          <CardDescription>Exact strings, whole words, symbol names or semantic similarity.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="e.g. handleUpload or User model" />
            <Select value={mode} onValueChange={(v) => setMode(v as (typeof SEARCH_MODES)[number])}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEARCH_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={run} disabled={busy || !query.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search
          </Button>

          {hits !== null && (
            <div className="space-y-1 pt-1">
              {hits.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No matches. Try another query or re-index.</p>
              ) : (
                hits.slice(0, 60).map((h, i) => (
                  <button key={i} onClick={() => open(h.path)} className="flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm hover:bg-muted">
                    <CircleDot className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{h.path}:{h.line}</span>
                      <span className="ml-2 text-[11px] text-muted-foreground">{h.kind}</span>
                      <div className="truncate text-xs text-muted-foreground">{h.content}</div>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">File preview</CardTitle>
          <CardDescription>{files.length} indexed files available.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[520px]">
            <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs">{symbolSig ?? "Click a search result to preview the file."}</pre>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------- Ask -----------------------------

function AskTab({ id }: { id: string }) {
  const [question, setQuestion] = React.useState("");
  const [answer, setAnswer] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const r = await codingApi.ask(id, question);
      setAnswer(r.answer);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Ask about the codebase</CardTitle>
        <CardDescription>The agent answers grounded in the indexed files, citing file:line locations.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What does the auth flow do, and where is it defined?" />
        <Button onClick={ask} disabled={busy || !question.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />} Ask
        </Button>
        {answer && <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-sm leading-6">{answer}</pre>}
      </CardContent>
    </Card>
  );
}

// ----------------------------- Plan & Changes -----------------------------

interface PlanView {
  taskId: string;
  summary: string;
  goals: string[];
  steps: { title: string; description: string; files: string[] }[];
  risks: string[];
}
interface ProposedChange {
  id: string;
  taskId: string;
  filePath: string;
  action: string;
  summary: string | null;
  additions: number;
  deletions: number;
  status: string;
  diffPreview: string;
}

function ChangesTab({ id }: { id: string }) {
  const [prompt, setPrompt] = React.useState("");
  const [busy, setBusy] = React.useState<"plan" | "propose" | null>(null);
  const [plan, setPlan] = React.useState<PlanView | null>(null);
  const [changes, setChanges] = React.useState<ProposedChange[]>([]);
  const [approveState, setApproveState] = React.useState<"idle" | "applying">("idle");

  const doPlan = async () => {
    if (!prompt.trim()) return;
    setBusy("plan");
    try {
      const p = await codingApi.plan(id, prompt);
      setPlan(p);
      setChanges([]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doPropose = async () => {
    if (!prompt.trim()) return;
    setBusy("propose");
    try {
      const c = await codingApi.propose(id, prompt);
      setChanges(c);
      if (!c.length) toast.info("No changes proposed — check the coding model is configured.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const approve = async (taskId: string) => {
    setApproveState("applying");
    try {
      const r = await codingApi.apply(id, taskId, { confirmed: true, runTests: true });
      toast.success(r.test ? (r.test.ok ? `Applied ${r.applied} change(s); tests PASSED.` : `Applied ${r.applied} change(s); tests FAILED (exit ${r.test.exitCode}).`) : `Applied ${r.applied} change(s).`);
      setChanges((prev) => prev.map((c) => (c.taskId === taskId ? { ...c, status: "applied" } : c)));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApproveState("idle");
    }
  };

  const reject = async (taskId: string) => {
    try {
      await codingApi.reject(id, taskId);
      setChanges((prev) => prev.map((c) => (c.taskId === taskId ? { ...c, status: "rejected" } : c)));
      toast.success("Changes rejected.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Describe the change</CardTitle>
          <CardDescription>Plan first to see steps and affected files, then propose exact diffs to approve.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Add a rate limiter to the document upload endpoint" />
          <div className="flex gap-2">
            <Button onClick={doPlan} disabled={busy !== null || !prompt.trim()}>
              {busy === "plan" ? <Loader2 className="size-4 animate-spin" /> : null} Plan
            </Button>
            <Button variant="outline" onClick={doPropose} disabled={busy !== null || !prompt.trim()}>
              {busy === "propose" ? <Loader2 className="size-4 animate-spin" /> : null} Propose changes
            </Button>
          </div>

          {plan && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">{plan.summary}</p>
              <ol className="space-y-1.5 text-sm">
                {plan.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span>
                      <strong>{s.title}</strong> — {s.description}
                      {s.files.length > 0 && <span className="text-xs text-muted-foreground"> (files: {s.files.join(", ")})</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {changes.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Proposed diffs appear here, ready for your approval.</CardContent></Card>}
        {changes.map((c) => (
          <Card key={c.id} className={c.status === "applied" ? "border-emerald-500/50" : c.status === "rejected" ? "opacity-60" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">
                  {c.action} · {c.filePath}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={c.status === "applied" ? "default" : c.status === "rejected" ? "destructive" : "secondary"}>{c.status}</Badge>
                  <span className="text-xs text-emerald-400">+{c.additions}</span>
                  <span className="text-xs text-rose-400">-{c.deletions}</span>
                </div>
              </div>
              {c.summary && <CardDescription>{c.summary}</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-2">
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-3 text-[11px] leading-4">{c.diffPreview || "(no preview)"}</pre>
              {(c.status === "proposed") && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approve(c.taskId)} disabled={approveState === "applying"}>
                    {approveState === "applying" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Approve &amp; apply
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => reject(c.taskId)} disabled={approveState === "applying"}>
                    <XCircle className="size-3.5" /> Reject
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ----------------------------- Review & Fix -----------------------------

interface FindingRow { severity: string; category: string; path: string; line: string; title: string; detail: string; suggestion: string }

function ReviewTab({ id }: { id: string }) {
  const [scope, setScope] = React.useState("");
  const [findings, setFindings] = React.useState<FindingRow[]>([]);
  const [debugSymptom, setDebugSymptom] = React.useState("");
  const [debugOut, setDebugOut] = React.useState<string | null>(null);
  const [refactorPrompt, setRefactorPrompt] = React.useState("");
  const [refactorOut, setRefactorOut] = React.useState<string | null>(null);
  const [docPrompt, setDocPrompt] = React.useState("");
  const [docOut, setDocOut] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const doReview = async () => {
    setBusy("review");
    try {
      const files = scope.split(",").map((s) => s.trim()).filter(Boolean);
      setFindings(await codingApi.review(id, files.length ? files : undefined));
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  const doDebug = async () => {
    if (!debugSymptom.trim()) return;
    setBusy("debug");
    try {
      const d = await codingApi.debug(id, debugSymptom);
      setDebugOut(`# ${d.summary}\n\n**Symptom:** ${d.symptom}\n**Root cause:** ${d.probableRootCause}\n**Suggested file:** ${d.suggestedFile || "—"}\n**Confidence:** ${d.confidence}\n\nEvidence:\n${d.evidence.map((e) => `- ${e}`).join("\n")}\n\nSuggested fix:\n${d.suggestedFix || "(none)"}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  const doRefactor = async () => {
    if (!refactorPrompt) return;
    setBusy("refactor");
    try {
      const r = await codingApi.refactor(id, refactorPrompt);
      setRefactorOut(`# ${r.summary}\n\n${r.changes.map((c) => `## ${c.path}\n${c.description}\n${(c.suggestedContent ? "Suggested new file content provided (copy from the diff)." : "")}\n${c.itemized.map((i) => `- ${i}`).join("\n")}`).join("\n\n")}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  const doDocs = async () => {
    if (!docPrompt) return;
    setBusy("docs");
    try {
      setDocOut(await codingApi.docs(id, docPrompt));
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Code review</CardTitle>
          <CardDescription>Static review of the most recent files (or a comma-separated list).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="Optional: src/util.ts, src/auth.ts" />
          <Button onClick={doReview} disabled={busy !== null}>
            {busy === "review" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Review
          </Button>
          <div className="space-y-2 pt-1">
            {findings.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No review run yet.</p>}
            {findings.map((f, i) => (
              <Card key={i} className={f.severity === "critical" || f.severity === "high" ? "border-destructive/50" : ""}>
                <CardContent className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={f.severity === "critical" ? "destructive" : f.severity === "high" ? "secondary" : "outline"}>{f.severity}</Badge>
                    <Badge variant="outline">{f.category}</Badge>
                    <span className="text-sm font-medium">{f.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{f.path}{f.line && `:${f.line}`}</p>
                  <p className="text-sm">{f.detail}</p>
                  {f.suggestion && <p className="text-xs text-muted-foreground">Suggestion: {f.suggestion}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Debug symptom</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value={debugSymptom} onChange={(e) => setDebugSymptom(e.target.value)} placeholder="e.g. Upload fails with 413 for files over 2MB" />
            <Button variant="outline" onClick={doDebug} disabled={busy !== null || !debugSymptom.trim()}>
              {busy === "debug" ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />} Analyze
            </Button>
            {debugOut && <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs">{debugOut}</pre>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Refactor / document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Refactor prompt" value={refactorPrompt} onChange={(e) => setRefactorPrompt(e.target.value)} />
            <Button variant="outline" size="sm" onClick={doRefactor} disabled={busy !== null || !refactorPrompt.trim()}>
              {busy === "refactor" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Suggest refactor
            </Button>
            {refactorOut && <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs">{refactorOut}</pre>}
            <Input placeholder="Docs prompt (or leave default)" value={docPrompt} onChange={(e) => setDocPrompt(e.target.value)} />
            <Button variant="outline" size="sm" onClick={doDocs} disabled={busy !== null}>
              {busy === "docs" ? <Loader2 className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />} Generate docs
            </Button>
            {docOut && <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs">{docOut}</pre>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ----------------------------- Run & Git -----------------------------

function RunTab({ id }: { id: string }) {
  const [command, setCommand] = React.useState("");
  const [confirmCmd, setConfirmCmd] = React.useState(false);
  const [cmdOut, setCmdOut] = React.useState<{ exitCode: number | null; stdout: string; stderr: string; durationMs: number; risk: string } | null>(null);
  const [testOut, setTestOut] = React.useState<{ ok: boolean; exitCode: number | null; stdout: string; durationMs: number } | null>(null);
  const [gitOut, setGitOut] = React.useState<string>("");
  const [gitAction, setGitAction] = React.useState("status");
  const [commitMsg, setCommitMsg] = React.useState("");
  const [confirmCommit, setConfirmCommit] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const runCmd = async () => {
    if (!command.trim()) return;
    setBusy(true);
    try {
      const r = await codingApi.command(id, command, { confirmed: confirmCmd });
      setCmdOut(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const runTest = async () => {
    setBusy(true);
    try {
      const r = await codingApi.test(id, {});
      setTestOut(r);
      toast.success(r.ok ? "Tests passed." : "Tests failed.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const git = async () => {
    setBusy(true);
    try {
      const r = await codingApi.git(id, gitAction);
      setGitOut(r.output);
    } catch (e) {
      setGitOut((e as Error).message);
    } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!commitMsg.trim()) return toast.error("Enter a commit message.");
    setBusy(true);
    try {
      const r = await codingApi.git(id, "commit", { args: [commitMsg.trim()], confirmed: confirmCommit });
      setGitOut(r.output || (r.ok ? "Commit created." : "Commit failed."));
      setCommitMsg("");
      if (r.ok) toast.success("Committed.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Command sandbox</CardTitle>
          <CardDescription>Allowlisted commands only; high-risk ones need confirmation. Blocked patterns never run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runCmd()} placeholder="npm test" />
          <div className="flex items-center gap-2">
            <Switch id="cmd-confirm" checked={confirmCmd} onCheckedChange={setConfirmCmd} />
            <Label htmlFor="cmd-confirm" className="text-xs font-normal">Confirm high-risk command</Label>
          </div>
          <Button onClick={runCmd} disabled={busy || !command.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Terminal className="size-4" />} Run
          </Button>
          {cmdOut && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs">
              <span className="font-medium">exit {cmdOut.exitCode} · risk {cmdOut.risk} · {cmdOut.durationMs}ms</span>
              {"\n"}{cmdOut.stdout}{"\n"}{cmdOut.stderr && `STDERR:\n${cmdOut.stderr}`}
            </pre>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Play className="size-4" /> Tests</CardTitle>
            <CardDescription>Auto-detects npm test / pytest, or pass a command above.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={runTest} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run tests
            </Button>
            {testOut && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs">{testOut.stdout}</pre>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><GitBranch className="size-4" /> Git</CardTitle>
            <CardDescription>The agent stays read-only; commits require the GIT_WRITE permission and this confirmation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Select value={gitAction} onValueChange={(v) => setGitAction(v ?? "status")}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="status">status</SelectItem>
                  <SelectItem value="diff">diff</SelectItem>
                  <SelectItem value="log">log</SelectItem>
                  <SelectItem value="branch"><span>branch</span></SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={git} disabled={busy}><RefreshCw className="size-3.5" /> Run</Button>
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs">{gitOut || "(run a git command to see output)"}</pre>
            <Separator />
            <div className="flex gap-2">
              <Input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Commit message" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="commit-confirm" checked={confirmCommit} onCheckedChange={setConfirmCommit} />
              <Label htmlFor="commit-confirm" className="text-xs font-normal">Confirm commit (never auto-pushes)</Label>
            </div>
            <Button size="sm" onClick={commit} disabled={busy || !commitMsg.trim()}><GitBranch className="size-3.5" /> Commit</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ----------------------------- Activity -----------------------------

function ActivityTab({ id, detail, onChanged }: { id: string; detail: CodingWorkspaceDetail; onChanged: () => void }) {
  const [tasks, setTasks] = React.useState<(CodingTaskLite & { plans: { id: string; title: string; steps: string; status: string }[]; changes: CodingChangeRow[]; testRuns: { id: string; command: string; status: string; exitCode: number | null; durationMs: number | null }[] })[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [label, setLabel] = React.useState("");

  React.useEffect(() => {
    codingApi.tasks(id).then(setTasks).catch(() => setTasks([]));
  }, [id, detail]);

  const snapshot = async () => {
    if (!label.trim()) return toast.error("Name the snapshot.");
    setBusy(true);
    try {
      const r = await codingApi.checkpoint(id, label);
      toast.success(`Snapshot ${r.snapshotId.slice(0, 8)} created.`);
      setLabel("");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const restore = async (snapshotId: string) => {
    if (!confirm("Restore this snapshot? Current workspace content will be overwritten.")) return;
    setBusy(true);
    try {
      const r = await codingApi.restore(id, snapshotId);
      toast.success(`Restored ${r.restored} files.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Tasks</CardTitle>
          <CardDescription>Every plan, proposal and application is recorded.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No tasks yet.</p>}
          {tasks.map((t) => (
            <div key={t.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{t.title}</span>
                <Badge variant={t.status === "done" ? "default" : t.status === "cancelled" ? "outline" : "secondary"}>{t.status}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.mode} · {t.changes.length} change(s) · {t.testRuns.length} test run(s)</p>
              {t.testRuns.map((tr) => (
                <p key={tr.id} className="mt-1 text-xs text-muted-foreground">· {tr.command} → <Badge variant={tr.status === "passed" ? "default" : tr.status === "failed" ? "destructive" : "outline"} className="h-4 px-1 text-[10px]">{tr.status}</Badge> {tr.exitCode !== null ? `exit ${tr.exitCode}` : ""}</p>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Snapshots & rollback</CardTitle>
          <CardDescription>Manual checkpoints for your own safety; restoring overwrites files back to that state.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Snapshot label (e.g. before big refactor)" />
            <Button variant="outline" onClick={snapshot} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />} Snapshot
            </Button>
          </div>
          <Separator />
          {detail.snapshots.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No snapshots yet.</p>}
          {detail.snapshots.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm">{s.reason}</p>
                <p className="text-xs text-muted-foreground">{s.id.slice(0, 8)} · {new Date(s.createdAt).toLocaleString()}</p>
              </div>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => restore(s.id)} className="text-destructive"><History className="size-3.5" /> Restore</Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// Module-level refactor prompt state (keeps ReviewTab lean).
function cut(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "\n… (truncated)" : s;
}
"use client";

import * as React from "react";
import {
  api,
  type ResearchSessionRow,
  type ResearchProgressPayload,
  type ResearchCostPayload,
  type ResearchFindingRow,
  type ResearchConflictRow,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FlaskConical, Globe, Loader2, Search, FileDown, BarChart2, Sparkles, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Markdown } from "@/components/markdown/markdown";
import { cn } from "@/lib/utils";

interface SessionDetail {
  id: string;
  topic: string;
  goal: string | null;
  status: string;
  mode: string;
  /** Parsed research plan; shape is owned by the server and not rendered yet. */
  plan: unknown;
  report: string | null;
  completedAt: string | null;
  sources: { 
    id: string; 
    title: string; 
    url: string; 
    provider: string | null; 
    publishedAt: string | null; 
    snippet: string | null; 
    relevance: number | null; 
    verified: boolean;
    sourceType?: string;
    domain?: string;
  }[];
  progress: ResearchProgressPayload | null;
  cost: ResearchCostPayload | null;
  findings: ResearchFindingRow[];
  conflicts: ResearchConflictRow[];
}

type ResearchMode = "quick" | "standard" | "deep";

const MODE_OPTIONS: { value: ResearchMode; label: string; description: string; queries: number; sources: number }[] = [
  { value: "quick", label: "Quick", description: "Fast overview, 5 queries, 10 sources", queries: 5, sources: 10 },
  { value: "standard", label: "Standard", description: "Balanced research, 10 queries, 25 sources", queries: 10, sources: 25 },
  { value: "deep", label: "Deep", description: "Comprehensive, 25 queries, 50 sources, multi-iteration", queries: 25, sources: 50 },
];

export function ResearchClient() {
  const [sessions, setSessions] = React.useState<ResearchSessionRow[] | null>(null);
  const [topic, setTopic] = React.useState("");
  const [goal, setGoal] = React.useState("");
  const [mode, setMode] = React.useState<ResearchMode>("standard");
  const [running, setRunning] = React.useState(false);
  const [detail, setDetail] = React.useState<SessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState<boolean>(false);
  const [tab, setTab] = React.useState<"report" | "sources" | "progress" | "findings">("report");

  const load = React.useCallback(() => {
    api.research().then((r) => setSessions(r.sessions)).catch(() => setSessions([]));
  }, []);

  React.useEffect(load, [load]);

  const start = async () => {
    if (!topic.trim()) {
      toast.error("Enter a research topic");
      return;
    }
    setRunning(true);
    try {
      const res = await api.startResearch({ topic: topic.trim(), goal: goal.trim() || undefined, mode });
      toast.success(`${MODE_OPTIONS.find(m => m.value === mode)?.label ?? mode} research started`);
      setTopic("");
      setGoal("");
      await load();
      await openSession(res.sessionId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const openSession = async (id: string) => {
    setLoadingDetail(true);
    setDetail(null);
    setTab("report");
    try {
      const r = await api.researchSession(id);
      setDetail(r.session);
      const isRunning = r.session.status === "running";
      if (isRunning) {
        setTimeout(() => void openSession(id), 2000);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const detailSessions = sessions ?? [];

  return (
    <div className="flex h-full min-w-0">
      {/* On mobile the list yields to the detail view once a run is selected. */}
      <ScrollArea className={cn("h-full min-w-0 flex-1", detail && "hidden md:block")}>
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Research</h1>
            <p className="text-sm text-muted-foreground">
              Runs the SEARCH → COLLECT → READ → COMPARE → VERIFY → SYNTHESIZE pipeline. Citations drawn only from retrieved sources.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">New research run</CardTitle>
              <CardDescription>Provide a topic; the workflow searches the web and compiles a cited dossier.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="topic">Topic</Label>
                <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Impact of RAG on enterprise search accuracy" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="goal">Goal (optional)</Label>
                <Textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="What should the report emphasize?" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mode">Research Depth</Label>
                <Select value={mode} onValueChange={(v) => v && setMode(v as ResearchMode)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select research depth" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODE_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        <div className="flex flex-col">
                          <span className="font-medium">{m.label}</span>
                          <span className="text-xs text-muted-foreground">{m.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={start} disabled={running || !topic.trim()} className="w-full">
                {running ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                {running ? "Running…" : "Run research"}
              </Button>
            </CardContent>
          </Card>

          {running && (
            <Alert>
              <FlaskConical className="size-4 animate-pulse" />
              <AlertTitle>Research in progress</AlertTitle>
              <AlertDescription>Searching providers, collecting sources and synthesizing the report. This can take up to a few minutes.</AlertDescription>
            </Alert>
          )}

          <h2 className="text-sm font-semibold">{sessions === null ? "Loading…" : `${detailSessions.length} runs`}</h2>

          {sessions === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          ) : detailSessions.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <FlaskConical className="mx-auto mb-2 size-8 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">No research runs yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2">
              {detailSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => void openSession(s.id)}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.topic}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString()} · {s.sourceCount} sources
                    </p>
                  </div>
                  <Badge variant={s.status === "complete" ? "secondary" : s.status === "running" ? "outline" : "destructive"}>{s.status}</Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <aside
        className={cn(
          "h-full min-w-0 shrink-0 border-l bg-background transition-all",
          detail ? "w-full md:w-1/2 lg:max-w-2xl" : "hidden md:block md:w-1/2 lg:max-w-2xl",
        )}
      >
        {detail ? <SessionViewer detail={detail} tab={tab} setTab={setTab} /> : loadingDetail ? <DetailSkeleton /> : <DetailEmpty />}
      </aside>
    </div>
  );
}

function DetailEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <FlaskConical className="size-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">Select a research run to view its report and sources.</p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-24 w-full animate-pulse rounded bg-muted" />
      <div className="h-24 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

type TabValue = "report" | "sources" | "progress" | "findings";

function SessionViewer({ detail, tab, setTab }: { detail: SessionDetail; tab: TabValue; setTab: (t: TabValue) => void }) {
  const download = () => {
    const blob = new Blob([detail.report ?? ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${detail.topic.replace(/[^\w\d-]+/g, "-").slice(0, 60)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    // Use browser print to PDF
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>${detail.topic}</title>
            <style>
              body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; line-height: 1.6; }
              h1, h2, h3 { color: #111; }
              a { color: #0066cc; }
              .citation { color: #666; font-size: 0.9em; }
            </style>
          </head>
          <body>${detail.report}</body>
        </html>
      `);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 500);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-base font-semibold tracking-tight">{detail.topic}</h3>
            <Badge variant="outline" className="text-xs">{detail.mode}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {detail.status} · {detail.sources.length} sources · {detail.completedAt ? `completed ${new Date(detail.completedAt).toLocaleString()}` : ""}
          </p>
          {detail.goal && <p className="mt-1 text-sm text-muted-foreground">{detail.goal}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={tab === "report" ? "default" : "ghost"} onClick={() => setTab("report")}>
            <Sparkles className="size-3.5 mr-1" /> Report
          </Button>
          <Button size="sm" variant={tab === "sources" ? "default" : "ghost"} onClick={() => setTab("sources")}>
            <Globe className="size-3.5 mr-1" /> Sources ({detail.sources.length})
          </Button>
          <Button size="sm" variant={tab === "progress" ? "default" : "ghost"} onClick={() => setTab("progress")}>
            <BarChart2 className="size-3.5 mr-1" /> Progress
          </Button>
          <Button size="sm" variant={tab === "findings" ? "default" : "ghost"} onClick={() => setTab("findings")}>
            <Sparkles className="size-3.5 mr-1" /> Findings
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportPDF} disabled={!detail.report}>
            <FileDown className="size-3.5" /> Export PDF
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={download} disabled={!detail.report}>
            <FileDown className="size-3.5" /> Download (.md)
          </Button>
        </div>

        {detail.status === "running" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Still working…
          </p>
        )}

        {tab === "report" ? (
          detail.report ? (
            <div className="rounded-xl border p-4 max-h-[calc(100vh-300px)] overflow-y-auto">
              <Markdown>{detail.report}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Report not generated yet.</p>
          )
        ) : tab === "progress" ? (
          <ProgressPanel progress={detail.progress} cost={detail.cost} />
        ) : tab === "findings" ? (
          <FindingsPanel detail={detail} />
        ) : detail.sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sources retrieved for this run.</p>
        ) : (
          <SourcePanel sources={detail.sources} />
        )}
      </div>
    </ScrollArea>
  );
}

function ProgressPanel({ progress, cost }: { progress?: SessionDetail["progress"]; cost?: SessionDetail["cost"] }) {
  if (!progress) return <p className="text-sm text-muted-foreground">No progress data available.</p>;

  const steps = [
    { id: "planning", label: "Planning", icon: Sparkles },
    { id: "searching", label: "Searching", icon: Search },
    { id: "analyzing", label: "Analyzing", icon: BarChart2 },
    { id: "verifying", label: "Verifying", icon: CheckCircle2 },
    { id: "synthesizing", label: "Synthesizing", icon: FlaskConical },
  ];

  const completedSteps = new Set(progress.stepsCompleted);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between mb-4">
          <span className="font-medium">Overall Progress</span>
          <span className="text-lg font-bold">{progress.percentage}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress.percentage}%` }} />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Steps</h4>
        {steps.map((step) => {
          const isCompleted = completedSteps.has(step.id);
          const isCurrent = progress.currentStep.toLowerCase().includes(step.label.toLowerCase()) && !isCompleted;
          return (
            <div key={step.id} className="flex items-center gap-3 p-3 rounded-lg border transition-colors">
              <div className={cn("flex size-8 items-center justify-center rounded-full text-sm font-medium", isCompleted ? "bg-green-100 text-green-700" : isCurrent ? "bg-primary/10 text-primary animate-pulse" : "bg-muted text-muted-foreground")}>
                <step.icon className="size-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{step.label}</p>
                <p className="text-xs text-muted-foreground">
                  {isCompleted ? "Completed" : isCurrent ? "In progress" : "Pending"}
                </p>
              </div>
              {isCompleted && <CheckCircle2 className="size-4 text-green-600" />}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border">
        <StatCard label="Sources Found" value={progress.sourcesFound} icon={Globe} />
        <StatCard label="Sources Analyzed" value={progress.sourcesAnalyzed} icon={BarChart2} />
        <StatCard label="Queries Executed" value={progress.queriesExecuted} icon={Search} />
        <StatCard label="Iterations" value={progress.iterationsCompleted} icon={Clock} />
      </div>

      {cost && (
        <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border bg-muted/30">
          <StatCard label="Search Requests" value={cost.searchRequests} icon={Search} />
          <StatCard label="AI Requests" value={cost.aiRequests} icon={Sparkles} />
          <StatCard label="Total Tokens" value={cost.totalTokens.toLocaleString()} icon={BarChart2} />
          <StatCard label="Est. Cost" value={`$${cost.estimatedCostUsd.toFixed(4)}`} icon={AlertCircle} />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-background">
      <Icon className="size-5 text-muted-foreground" />
      <div>
        <p className="text-sm font-semibold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/** Presentation for each confidence level the research pipeline can emit. */
const CONFIDENCE_STYLES: Record<string, { label: string; className: string }> = {
  strongly_supported: { label: "Strongly supported", className: "bg-green-100 text-green-700" },
  supported: { label: "Supported", className: "bg-green-50 text-green-700" },
  mixed_evidence: { label: "Mixed evidence", className: "bg-amber-100 text-amber-800" },
  limited_evidence: { label: "Limited evidence", className: "bg-muted text-muted-foreground" },
  uncertain: { label: "Uncertain", className: "bg-destructive/10 text-destructive" },
};

const UNCERTAIN_STYLE = CONFIDENCE_STYLES.uncertain;

/** Findings extracted from sources, with their supporting evidence and conflicts. */
function FindingsPanel({ detail }: { detail: SessionDetail }) {
  const { findings, conflicts } = detail;

  if (findings.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">No findings were extracted for this run.</p>
        <p className="text-xs text-muted-foreground">
          Findings need readable source text. If the pages could not be fetched (paywall, JavaScript-only, or blocked),
          or no search provider is configured, there is nothing to extract.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {conflicts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
            <AlertCircle className="size-4" />
            {conflicts.length} possible conflict{conflicts.length === 1 ? "" : "s"} detected
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {conflicts.map((conflict) => (
              <li key={conflict.id} className="text-xs text-amber-900/90">{conflict.description}</li>
            ))}
          </ul>
        </div>
      )}

      {findings.map((finding) => {
        const style = CONFIDENCE_STYLES[finding.confidence] ?? UNCERTAIN_STYLE;
        return (
          <div key={finding.id} className="rounded-lg border bg-background p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{finding.category}</Badge>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", style.className)}>{style.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {finding.sourceIds.length} source{finding.sourceIds.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-sm">{finding.claim}</p>
            {finding.evidence.length > 0 && (
              <ul className="mt-2 space-y-1.5 border-l-2 pl-3">
                {finding.evidence.slice(0, 4).map((evidence, index) => (
                  <li key={`${finding.id}-${index}`} className="text-xs text-muted-foreground">
                    <span className="mr-1 text-[10px] font-semibold uppercase">{evidence.supports}</span>
                    {`"${evidence.excerpt}"`}
                    {evidence.url && (
                      <a
                        href={evidence.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ml-1 underline hover:no-underline"
                      >
                        source
                      </a>
                    )}
                  </li>
                ))}
                {finding.evidence.length > 4 && (
                  <li className="text-xs text-muted-foreground">+{finding.evidence.length - 4} more excerpts</li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SourcePanel({ sources }: { sources: SessionDetail["sources"] }) {
  return (
    <div className="grid gap-2 max-h-[calc(100vh-300px)] overflow-y-auto">
      {sources.map((s) => (
        <SourceCard key={s.id} source={s} />
      ))}
    </div>
  );
}

function SourceCard({ source }: { source: SessionDetail["sources"][0] }) {
  const badges: React.ReactNode[] = [];

  if (source.verified) badges.push(<Badge key="verified" variant="secondary" className="gap-1"><CheckCircle2 className="size-2.5" /> Verified</Badge>);
  if (source.sourceType) badges.push(<Badge key="type" variant="outline" className="text-[10px]">{source.sourceType}</Badge>);

  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <div className="flex items-start gap-2">
        <a href={source.url} target="_blank" rel="noreferrer noopener" className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate hover:underline">{source.title}</p>
          <p className="text-xs text-muted-foreground truncate">{source.url}</p>
        </a>
        <div className="flex flex-wrap gap-1">{badges}</div>
      </div>
      {source.snippet && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{source.snippet}</p>}
      <p className="mt-1 text-[11px] text-muted-foreground flex flex-wrap gap-3">
        <span>{source.domain ? `Domain: ${source.domain}` : ""}</span>
        <span>{source.provider ? `Provider: ${source.provider}` : ""}</span>
        {source.publishedAt && <span>Published: {new Date(source.publishedAt).toLocaleDateString()}</span>}
        {source.relevance != null && <span>Relevance: {Math.round(source.relevance * 100)}%</span>}
      </p>
    </div>
  );
}

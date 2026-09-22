"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown/markdown";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown, Copy, FileText, FileUp, Globe, Sparkles, Wrench } from "lucide-react";

export interface UiSource {
  title: string;
  url: string;
  provider?: string;
  snippet?: string;
  relevance?: number;
}

export interface UiToolUse {
  name: string;
  status: "running" | "success" | "error" | "waiting_confirmation";
  summary?: string;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  sources?: UiSource[];
  tools?: UiToolUse[];
  usage?: { prompt?: number; completion?: number; total?: number };
  attachments?: { name: string; type: string }[];
  pending?: boolean;
  error?: string | null;
}

export function MessageItem({ message, showAgentLabel }: { message: UiMessage; showAgentLabel?: string }) {
  const [copied, setCopied] = React.useState(false);
  const [reasoningOpen, setReasoningOpen] = React.useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end px-4 py-2">
        <div className="max-w-[85%] rounded-2xl bg-sidebar-primary px-4 py-2.5 text-sidebar-primary-foreground">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {message.attachments.map((a, i) => (
                <span key={i} className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-xs">
                  <FileUp className="size-3" />
                  {a.name}
                </span>
              ))}
            </div>
          )}
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 px-4 py-2">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg brand-gradient text-white">
        <Sparkles className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <p className="text-xs font-semibold tracking-tight">AI Nexus</p>
          {showAgentLabel && <Badge variant="secondary" className="text-[10px]">{showAgentLabel}</Badge>}
        </div>

        {message.error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message.error}</p>}

        {message.content ? (
          <div className={cn("text-sm", message.pending && "streaming-caret text-base leading-relaxed")}>
            <Markdown>{message.content}</Markdown>
          </div>
        ) : message.pending ? (
          <div className="text-sm text-muted-foreground">
            <span className="streaming-caret" />
          </div>
        ) : null}

        {message.tools && message.tools.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.tools.map((t, i) => (
              <span
                key={i}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
                  t.status === "running" && "border-sidebar-ring/40 bg-sidebar-accent/40 text-muted-foreground",
                  t.status === "success" && "border-emerald-600/30 bg-emerald-600/5 text-emerald-600",
                  t.status === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
                  t.status === "waiting_confirmation" && "border-amber-600/40 bg-amber-600/5 text-amber-600",
                )}
              >
                <Wrench className="size-3" />
                {t.name}
                {t.summary ? ` — ${t.summary}` : ""}
              </span>
            ))}
          </div>
        )}

        {message.sources && message.sources.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {message.sources.map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex max-w-[260px] items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                title={s.snippet ?? s.title}
              >
                <Globe className="size-3 shrink-0" />
                <span className="truncate">{s.title}</span>
              </a>
            ))}
          </div>
        )}

        {message.reasoning && (
          <div className="mt-2">
            <button onClick={() => setReasoningOpen((v) => !v)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <ChevronDown className={cn("size-3 transition-transform", reasoningOpen && "rotate-180")} />
              {reasoningOpen ? "Hide reasoning" : "Show reasoning"}
            </button>
            {reasoningOpen && (
              <div className="mt-1.5 border-l-2 border-sidebar-ring/40 pl-3 text-xs text-muted-foreground">
                <Markdown>{message.reasoning}</Markdown>
              </div>
            )}
          </div>
        )}

        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {message.content && (
            <>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(message.content).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
                className="flex items-center gap-1 transition-colors hover:text-foreground"
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
              {message.usage && message.usage.total ? (
                <span className="flex items-center gap-1">
                  <FileText className="size-3" />
                  {message.usage.total.toLocaleString()} tokens
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
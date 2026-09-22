"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ShieldAlert } from "lucide-react";

interface Overview {
  users: number;
  activeConversations: number;
  messages: number;
  messages24h: number;
  aiRequests24h: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalAiMs: number;
  toolCalls7d: number;
  errors: number;
}

export function AdminClient() {
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [usage, setUsage] = React.useState<{ provider: string; model: string; tokens: number }[]>([]);
  const [security, setSecurity] = React.useState<{ id: string; action: string; createdAt: string; meta: unknown }[]>([]);

  React.useEffect(() => {
    api.adminOverview().then((r) => {
      setOverview(r.overview);
      setUsage(r.tokenUsageByModel);
      setSecurity(r.recentSecurityEvents);
    }).catch(() => {});
  }, []);

  if (!overview) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 md:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">System overview, usage and security telemetry.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Messages (24h)" value={overview.messages24h.toLocaleString()} />
          <Stat label="AI requests (24h)" value={overview.aiRequests24h.toLocaleString()} />
          <Stat label="Total tokens" value={overview.totalTokens.toLocaleString()} />
          <Stat label="Errors" value={overview.errors.toLocaleString()} accent={overview.errors > 0} />
          <Stat label="Users" value={overview.users.toLocaleString()} />
          <Stat label="Conversations" value={overview.activeConversations.toLocaleString()} />
          <Stat label="Tool calls (7d)" value={overview.toolCalls7d.toLocaleString()} />
          <Stat label="Model latency" value={`${(overview.totalAiMs / 1000).toFixed(1)}s`} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Token usage by model</CardTitle>
            <CardDescription>Aggregated across all requests in the retention window.</CardDescription>
          </CardHeader>
          <CardContent>
            {usage.length === 0 ? (
              <p className="text-sm text-muted-foreground">No usage recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {usage.map((u) => {
                  const max = Math.max(...usage.map((x) => x.tokens));
                  return (
                    <div key={`${u.provider}:${u.model}`} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-sm">
                        {u.provider}/{u.model}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full brand-gradient" style={{ width: `${Math.max(2, (u.tokens / max) * 100)}%` }} />
                      </div>
                      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{u.tokens.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4" /> Recent security events
            </CardTitle>
            <CardDescription>Rate-limit hits, failed logins and sensitive-operations audits.</CardDescription>
          </CardHeader>
          <CardContent>
            {security.length === 0 ? (
              <p className="text-sm text-muted-foreground">No security events in the window.</p>
            ) : (
              <div className="space-y-2">
                {security.map((e) => (
                  <div key={e.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="min-w-0">
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        {e.action}
                      </Badge>
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{JSON.stringify(e.meta)}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className={cn("text-2xl font-semibold tabular-nums", accent && "text-destructive")}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
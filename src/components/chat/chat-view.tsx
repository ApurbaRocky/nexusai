"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, type MessageType } from "@/lib/api";
import { postChat, type StreamHandle } from "@/lib/chat-client";
import { Composer, type ComposerAgentOption, type ComposerAttachment, type ComposerModelOption } from "@/components/chat/composer";
import { MessageItem, type UiMessage, type UiSource } from "@/components/chat/message-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sparkles, AlertTriangle, MessageSquarePlus } from "lucide-react";

interface ChatViewProps {
  conversationId?: string;
}

export function ChatView({ conversationId }: ChatViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = React.useState<boolean>(!!conversationId);
  const [title, setTitle] = React.useState("New chat");
  const [streaming, setStreaming] = React.useState(false);
  const [agents, setAgents] = React.useState<ComposerAgentOption[]>([]);
  const [models, setModels] = React.useState<ComposerModelOption[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const handleRef = React.useRef<StreamHandle | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => () => handleRef.current?.abort(), []);

  const loadModels = React.useCallback(async () => {
    try {
      const res = await api.models();
      setAgents(res.agents.map((a) => ({ id: a.id, name: a.name })));
      setModels(
        res.models
          .filter((m) => m.mock || m.available)
          .map((m) => ({ id: m.id, label: m.mock ? `${m.label} (demo)` : m.label, provider: m.provider, available: m.available })),
      );
    } catch {
      /* guarded by proxy */
    }
  }, []);

  React.useEffect(() => {
    loadModels();
  }, [loadModels]);

  React.useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setTitle("New chat");
      setLoadingHistory(false);
      return;
    }
    setLoadingHistory(true);
    api
      .conversation(conversationId)
      .then((res) => {
        setTitle(res.conversation.title);
        setMessages(toUiMessages(res.messages));
        setLoadingHistory(false);
      })
      .catch(() => {
        setLoadingHistory(false);
        setError("Conversation not found, or it belongs to another workspace.");
      });
  }, [conversationId]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const stop = () => {
    handleRef.current?.abort();
    setMessages((prev) =>
      prev.map((m) =>
        m.pending
          ? { ...m, pending: false, error: null, tools: (m.tools ?? []).map((t) => (t.status === "running" ? { ...t, status: "error" as const, summary: "stopped" } : t)) }
          : m,
      ),
    );
    setStreaming(false);
  };

  const send = async (content: string, opts: { agent?: string; model?: string; attachments: ComposerAttachment[] }) => {
    if (!content && opts.attachments.length === 0) return;
    setError(null);

    const attachmentMeta = opts.attachments.map((a) => ({ name: a.name, type: a.type, size: a.size, dataUrl: a.dataUrl }));

    const userMsg: UiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      attachments: attachmentMeta.map(({ name, type }) => ({ name, type })),
    };
    const assistantMsg: UiMessage = { id: crypto.randomUUID(), role: "assistant", content: "", pending: true, tools: [], sources: [] };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    let resolvedConversationId = conversationId ?? null;
    if (!resolvedConversationId) {
      try {
        const created = await api.createConversation({ title: content.slice(0, 60) || "New chat", agentId: opts.agent, model: opts.model });
        resolvedConversationId = created.id;
        router.replace(`/chat/${created.id}`, { scroll: false });
      } catch {
        /* stateless reply still works */
      }
    }

    setStreaming(true);
    const activeTools = new Map<string, NonNullable<UiMessage["tools"]>[number]>();

    const handle = await postChat(
      {
        conversationId: resolvedConversationId,
        content,
        model: opts.model || null,
        agent: opts.agent || null,
        attachments: attachmentMeta.length ? attachmentMeta : undefined,
      },
      (ev) => {
        switch (ev.type) {
          case "text_delta":
            setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + ev.content } : m)));
            break;
          case "reasoning_delta":
            setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...m, reasoning: (m.reasoning ?? "") + ev.content } : m)));
            break;
          case "tool_start":
            {
              const tool = { name: ev.tool, status: "running" as const };
              activeTools.set(ev.id, tool);
              setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...m, tools: [...(m.tools ?? []), tool] } : m)));
            }
            break;
          case "tool_result":
            {
              const prev = activeTools.get(ev.id);
              if (prev) {
                activeTools.set(ev.id, { ...prev, status: ev.success ? "success" : "error", summary: ev.summary });
                setMessages((m) => m.map((mm) => (mm.id === assistantMsg.id ? { ...mm, tools: (mm.tools ?? []).map((t) => (t === prev ? { ...t, status: ev.success ? ("success" as const) : ("error" as const), summary: ev.summary } : t)) } : mm)));
              }
            }
            break;
          case "source":
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsg.id) return m;
                const sources: UiSource[] = [...(m.sources ?? [])];
                if (!sources.some((s) => s.url === ev.source.url)) sources.push(ev.source);
                return { ...m, sources };
              }),
            );
            break;
          case "usage":
            setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...m, usage: { prompt: ev.promptTokens, completion: ev.completionTokens, total: ev.totalTokens } } : m)));
            break;
          case "done":
            setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...m, pending: false } : m)));
            setStreaming(false);
            break;
          case "error":
            setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...m, pending: false, error: ev.message } : m)));
            if (!messages.some((m) => m.id === assistantMsg.id)) {
              setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...m, pending: false, error: ev.message } : m)));
            }
            setStreaming(false);
            break;
        }
      },
    );
    handleRef.current = handle;
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 md:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1>
        </div>
        {searchParams.get("demo") === "1" && <Badge variant="outline">Demo mode</Badge>}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl pb-6 pt-4">
          {loadingHistory ? (
            <div className="space-y-4 px-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-7 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 && !error ? (
            <EmptyState />
          ) : error && messages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <AlertTriangle className="size-8 text-destructive" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Link href="/chat" className="text-sm underline underline-offset-4">
                Start a new chat
              </Link>
            </div>
          ) : (
            messages.map((m) => <MessageItem key={m.id} message={m} />)
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <Composer streaming={streaming} agents={agents} models={models} onSend={send} onStop={stop} />
    </div>
  );
}

function toUiMessages(records: MessageType[]): UiMessage[] {
  return records
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      content: r.content ?? "",
      error: r.error,
      attachments: r.attachments ?? undefined,
      sources: r.sources?.map((s) => ({ title: s.title, url: s.url, provider: s.provider, snippet: s.snippet, relevance: s.relevance })) as UiSource[] | undefined,
      usage: r.tokens ?? undefined,
    }));
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl brand-gradient text-white">
        <Sparkles className="size-6" />
      </div>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">How can I help you?</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Research, learn, plan, debug and draft. Pick an agent from the controls below to shape the behaviour, or leave the assistant in charge of routing.
        </p>
      </div>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <MessageSquarePlus className="size-4" /> Start typing below to begin.
      </span>
    </div>
  );
}
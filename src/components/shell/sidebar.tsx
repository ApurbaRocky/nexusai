"use client";

/* eslint-disable */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { api, type ConversationSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { signOutAction } from "@/actions/session";
import {
  MessageSquare,
  FolderKanban,
  FlaskConical,
  FileText,
  Brain,
  Settings,
  ShieldCheck,
  Search,
  Plus,
  LogOut,
  Trash2,
  Sparkles,
} from "lucide-react";

const NAV = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/research", label: "Research", icon: FlaskConical },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

// eslint-disable-next-line
export function Sidebar({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [conversations, setConversations] = React.useState<ConversationSummary[] | null>(null);
  const [query, setQuery] = React.useState("");
  const [role, setRole] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const conversationsRes = await api.conversations();
        if (alive) setConversations(conversationsRes.conversations);
      } catch {
        if (alive) setConversations([]);
      }
      try {
        const settingsRes = await api.settings();
        if (alive) {
          setRole(settingsRes.profile.role);
          setName(settingsRes.profile.name);
        }
      } catch {
        // ignore
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [pathname]);

  const filtered = React.useMemo(() => {
    if (!conversations) return null;
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    await api.deleteConversation(id).catch(() => {});
    setConversations((prev) => prev?.filter((c) => c.id !== id) ?? null);
    if (pathname === `/chat/${id}`) router.push("/chat");
    toast.success("Conversation deleted");
  };

  const navFor = (href: string) => (href: string) => pathname === href || pathname.startsWith(href + "/");
  const isActive = navFor(pathname.split("/").slice(0, 2).join("/"));

  return (
    <aside className={cn("flex h-full flex-col border-r bg-sidebar text-sidebar-foreground transition-all", collapsed ? "w-0 overflow-hidden" : "w-64")}>
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg brand-gradient text-white">
          <Sparkles className="size-4" />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">AI Nexus</p>
            <p className="text-[11px] text-muted-foreground">Multi-agent assistant</p>
          </div>
        )}
      </div>

      <div className="px-3 pb-2">
        <Button className="w-full justify-start gap-2" onClick={() => router.push("/chat")}>
          <Plus className="size-4" />
          New Chat
        </Button>
      </div>

      <nav className="space-y-0.5 px-3 pb-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
        {role === "admin" && (
          <Link
            href="/admin"
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              pathname.startsWith("/admin") ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <ShieldCheck className="size-4 shrink-0" />
            Admin
          </Link>
        )}
      </nav>

      <div className="mx-3 mt-1 border-t" />

      <div className="px-3 pb-1 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats…" className="h-8 pl-8 text-xs" />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 py-2">
        {filtered === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full rounded-md" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{conversations && conversations.length === 0 ? "No conversations yet." : "No matches."}</p>
        ) : (
          filtered.map((conversation) => {
            const active = pathname === `/chat/${conversation.id}`;
            return (
              <Tooltip key={conversation.id}>
                <TooltipTrigger
                  render={
                    <Link
                      href={`/chat/${conversation.id}`}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-2 rounded-md py-1.5 pl-2 pr-1.5 text-sm transition-colors",
                        active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    />
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{conversation.title || "Untitled chat"}</span>
                  <button
                    onClick={(e) => deleteConversation(e, conversation.id)}
                    className="invisible text-muted-foreground/60 transition-colors hover:text-destructive group-hover:visible"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{conversation.title}</TooltipContent>
              </Tooltip>
            );
          })
        )}
      </ScrollArea>

      <div className="flex items-center justify-between border-t px-3 py-2.5">
        <Button variant="ghost" size="sm" className="flex items-center gap-2 text-muted-foreground" onClick={() => router.push("/settings")}>
          <span className="flex size-6 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
            {(name || "U").slice(0, 1).toUpperCase()}
          </span>
          <span className="max-w-[120px] truncate text-xs">{name || "Account"}</span>
        </Button>
        <SignOutButton />
      </div>
    </aside>
  );
}

function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="icon" className="text-muted-foreground" title="Sign out">
        <LogOut className="size-4" />
      </Button>
    </form>
  );
}
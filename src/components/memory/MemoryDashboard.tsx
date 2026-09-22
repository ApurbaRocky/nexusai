"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Brain,
  Network,
  Download,
  Loader2,
  Search,
  Tag,
  CheckCircle,
  Archive,
  Settings,
} from "lucide-react";
import {
  StatCard,
  MemoryCard,
  MemoryDetailModal,
  KnowledgeGraphView,
  MemorySettings,
} from "./MemoryDashboardParts";

interface MemoryItem {
  id: string;
  type: string;
  scope: string;
  title: string | null;
  content: string;
  summary: string | null;
  importance: number;
  confidence: number;
  tags: string[];
  entities: string[];
  privacyLevel: string;
  userVisible: boolean;
  userConfirmed: boolean;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  expiresAt: string | null;
  projectId: string | null;
  conversationId: string | null;
  taskId: string | null;
}

interface MemorySearchResult {
  memory: MemoryItem;
  score: number;
  matchedFields: string[];
}

interface MemoryStats {
  total: number;
  active: number;
  archived: number;
  byType: Record<string, number>;
  byScope: Record<string, number>;
  avgImportance: number;
  avgConfidence: number;
}

export function MemoryDashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "search" | "knowledge-graph" | "settings">("overview");
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [memories, setMemories] = useState<MemorySearchResult[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<MemorySearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState<string>("");
  const [searchScope, setSearchScope] = useState<string>("");
  const [searchProject] = useState<string>("");
  const [minImportance, setMinImportance] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [exportFormat, setExportFormat] = useState<"JSON" | "CSV" | "MARKDOWN">("JSON");

  const typeLabels: Record<string, string> = {
    USER_PROFILE: "User Profile",
    PREFERENCE: "Preference",
    PROJECT: "Project",
    CONVERSATION: "Conversation",
    TASK: "Task",
    DOCUMENT: "Document",
    RESEARCH: "Research",
    EDUCATION: "Education",
    CODING: "Coding",
    BROWSER: "Browser",
  };

  const scopeLabels: Record<string, string> = {
    GLOBAL_USER: "Global",
    PROJECT: "Project",
    CONVERSATION: "Conversation",
    TASK: "Task",
    DOCUMENT_COLLECTION: "Documents",
    AGENT: "Agent",
    SESSION: "Session",
  };


  const loadStats = useCallback(async () => {
    try {
      const data = await api.get<MemoryStats>("/api/memory/stats");
      setStats(data);
    } catch {
      console.error("Failed to load stats");
    }
  }, []);

  const searchMemories = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("q", searchQuery);
      if (searchType) params.set("types", searchType);
      if (searchScope) params.set("scopes", searchScope);
      if (searchProject) params.set("projectId", searchProject);
      if (minImportance > 0) params.set("minImportance", minImportance.toString());
      params.set("maxResults", "50");

      const data = await api.get<MemorySearchResult[]>(`/api/memory?${params.toString()}`);
      setMemories(data);
    } catch {
      toast.error("Search failed");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, searchType, searchScope, searchProject, minImportance]);

  const loadMemory = useCallback(async (id: string) => {
    try {
      const data = await api.get<{ memory: MemoryItem }>(`/api/memory/${id}`);
      if (data.memory) {
        setSelectedMemory({
          memory: data.memory,
          score: 1,
          matchedFields: [],
        });
        setShowDetail(true);
      }
    } catch {
      toast.error("Failed to load memory");
    }
  }, []);

  const deleteMemory = useCallback(async (id: string) => {
    if (!confirm("Are you sure you want to delete this memory?")) return;
    try {
      await api.delete<{ ok: boolean }>(`/api/memory/${id}`);
      toast.success("Memory deleted");
      setMemories((prev) => prev.filter((m) => m.memory.id !== id));
      setShowDetail(false);
      loadStats();
    } catch {
      toast.error("Failed to delete memory");
    }
  }, [loadStats]);

  const archiveMemory = useCallback(async (id: string) => {
    try {
      await api.patch<{ ok: boolean }>(`/api/memory/${id}`, { status: "ARCHIVED" });
      toast.success("Memory archived");
      searchMemories();
      loadStats();
    } catch {
      toast.error("Failed to archive memory");
    }
  }, [searchMemories, loadStats]);

  const exportMemories = useCallback(async () => {
    if (memories.length === 0) {
      toast.error("No memories to export");
      return;
    }
    try {
      const ids = memories.map((m) => m.memory.id);
      const response = await fetch("/api/memory/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryIds: ids, format: exportFormat }),
      });

      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `memory-export-${new Date().toISOString().split("T")[0]}.${exportFormat.toLowerCase()}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Export complete");
    } catch {
      toast.error("Export failed");
    }
  }, [memories, exportFormat]);

  useEffect(() => {
    loadStats();
    searchMemories();
  }, [loadStats, searchMemories]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 border-b">
        <div>
          <h1 className="text-xl font-semibold">Memory Dashboard</h1>
          <p className="text-sm text-muted-foreground">Manage your AI&apos;s long-term memory</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as "JSON" | "CSV" | "MARKDOWN")}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="JSON">JSON</SelectItem>
              <SelectItem value="CSV">CSV</SelectItem>
              <SelectItem value="MARKDOWN">Markdown</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={exportMemories} disabled={memories.length === 0} variant="outline">
            <Download className="size-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsList className="grid w-full grid-cols-4 px-4">
          <TabsTrigger value="overview">
            <Brain className="size-4 mr-2" /> Overview
          </TabsTrigger>
          <TabsTrigger value="search">
            <Search className="size-4 mr-2" /> Search
          </TabsTrigger>
          <TabsTrigger value="knowledge-graph">
            <Network className="size-4 mr-2" /> Knowledge Graph
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="size-4 mr-2" /> Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 p-4 overflow-auto">
          {stats && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
              <StatCard title="Total Memories" value={stats.total} icon={<Brain className="size-5" />} />
              <StatCard title="Active" value={stats.active} icon={<CheckCircle className="size-5" />} color="green" />
              <StatCard title="Archived" value={stats.archived} icon={<Archive className="size-5" />} color="blue" />
              <StatCard title="Avg Importance" value={`${(stats.avgImportance * 100).toFixed(0)}%`} icon={<Tag className="size-5" />} color="purple" />
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Memory Types</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 md:grid-cols-3">
                {stats && Object.entries(stats.byType).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between p-3 rounded-lg border">
                    <span className="font-medium">{typeLabels[type] || type}</span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Memory Scopes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 md:grid-cols-3">
                {stats && Object.entries(stats.byScope).map(([scope, count]) => (
                  <div key={scope} className="flex items-center justify-between p-3 rounded-lg border">
                    <span className="font-medium">{scopeLabels[scope] || scope}</span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search" className="flex-1 p-4 overflow-auto">
          <Card className="mb-4">
            <CardContent className="space-y-4">
              <div className="flex gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <Label>Search</Label>
                  <Input
                    placeholder="Search memories..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchMemories()}
                  />
                </div>
                <div className="min-w-[150px]">
                  <Label>Type</Label>
                  <Select value={searchType} onValueChange={(value) => setSearchType(value ?? "")}>
                    <SelectTrigger>
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All types</SelectItem>
                      {Object.entries(typeLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[150px]">
                  <Label>Scope</Label>
                  <Select value={searchScope} onValueChange={(value) => setSearchScope(value ?? "")}>
                    <SelectTrigger>
                      <SelectValue placeholder="All scopes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All scopes</SelectItem>
                      {Object.entries(scopeLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[120px] flex items-end">
                  <Label>Min Importance</Label>
                  <Input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={minImportance}
                    onChange={(e) => setMinImportance(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <Button onClick={searchMemories} disabled={loading}>
                  <Search className="size-4 mr-2" /> {loading ? "Searching..." : "Search"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <ScrollArea className="h-[calc(100%-200px)]">
            <div className="space-y-2">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
              ) : memories.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="size-12 mx-auto mb-2 opacity-50" />
                  <p>No memories found</p>
                </div>
              ) : (
                memories.map((result) => (
                  <MemoryCard
                    key={result.memory.id}
                    memory={result}
                    onClick={() => loadMemory(result.memory.id)}
                    onDelete={deleteMemory}
                    onArchive={archiveMemory}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="knowledge-graph" className="flex-1 p-4 overflow-auto">
          <KnowledgeGraphView />
        </TabsContent>

        <TabsContent value="settings" className="flex-1 p-4 overflow-auto">
          <MemorySettings />
        </TabsContent>
      </Tabs>

      {showDetail && selectedMemory && (
      <MemoryDetailModal
        memory={selectedMemory}
        onClose={() => setShowDetail(false)}
        onDelete={deleteMemory}
        onArchive={archiveMemory}
      />
    )}
  </div>
  );
}
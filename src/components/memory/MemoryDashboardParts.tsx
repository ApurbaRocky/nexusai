"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Brain,
  Network,
  Tag,
  FolderOpen,
  CheckCircle,
  XCircle,
  AlertTriangle,
  History,
  Archive,
  Trash2,
  Settings,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useState, useEffect, useCallback } from "react";

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
  matchedFields?: string[];
}

interface MemorySearchResult {
  memory: MemoryItem;
  score: number;
  matchedFields: string[];
}

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

const privacyColors: Record<string, string> = {
  NORMAL: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  PRIVATE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  HIGHLY_PRIVATE: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  ARCHIVED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  EXPIRED: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  DELETED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function StatCard({
  title,
  value,
  icon,
  color = "blue",
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
}) {
  const colors: Record<string, string> = {
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    green: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    purple: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    orange: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
          <div className={cn("p-2 rounded-lg", colors[color])}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function MemoryCard({
  memory,
  onClick,
  onDelete,
  onArchive,
}: {
  memory: MemorySearchResult;
  onClick: () => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const { memory: m } = memory;

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge variant="secondary" className="gap-1">
                <Tag className="size-3" /> {typeLabels[m.type] || m.type}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <FolderOpen className="size-3" /> {scopeLabels[m.scope] || m.scope}
              </Badge>
              <Badge
                variant="outline"
                className={cn("gap-1", privacyColors[m.privacyLevel])}
              >
                <AlertTriangle className="size-3" /> {m.privacyLevel}
              </Badge>
              <Badge
                variant="outline"
                className={cn("gap-1", statusColors[m.status])}
              >
                <CheckCircle className="size-3" /> {m.status}
              </Badge>
            </div>

            {m.title && <h4 className="font-medium text-lg mb-1">{m.title}</h4>}

            <p className="text-sm text-muted-foreground line-clamp-2">
              {m.content}
            </p>

            {m.summary && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-1">
                {m.summary}
              </p>
            )}

            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Tag className="size-3" />
                Importance: {(m.importance * 100).toFixed(0)}%
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="size-3" />
                Confidence: {(m.confidence * 100).toFixed(0)}%
              </span>
              <span className="flex items-center gap-1">
                <History className="size-3" />
                {formatDistanceToNow(new Date(m.updatedAt), { addSuffix: true })}
              </span>
              {m.userConfirmed && (
                <Badge variant="default" className="gap-1">
                  <CheckCircle className="size-3" /> Confirmed
                </Badge>
              )}
            </div>

            {m.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {m.tags.slice(0, 5).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
                {m.tags.length > 5 && (
                  <Badge variant="outline" className="text-xs">
                    +{m.tags.length - 5} more
                  </Badge>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onArchive(m.id); }}>
              <Archive className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDelete(m.id); }} className="text-destructive hover:text-destructive">
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MemoryDetailModal({
  memory,
  onClose,
  onDelete,
  onArchive,
}: {
  memory: MemorySearchResult;
  onClose: () => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const { memory: m } = memory;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background w-full max-w-3xl max-h-[90vh] rounded-lg border shadow-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Memory Details</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="size-5" />
          </Button>
        </div>

        <ScrollArea className="flex-1 p-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <Tag className="size-3" /> {typeLabels[m.type] || m.type}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <FolderOpen className="size-3" /> {scopeLabels[m.scope] || m.scope}
            </Badge>
            <Badge className={cn("gap-1", privacyColors[m.privacyLevel])}>
              <AlertTriangle className="size-3" /> {m.privacyLevel}
            </Badge>
            <Badge className={cn("gap-1", statusColors[m.status])}>
              <CheckCircle className="size-3" /> {m.status}
            </Badge>
            {m.userConfirmed && (
              <Badge variant="default" className="gap-1">
                <CheckCircle className="size-3" /> User Confirmed
              </Badge>
            )}
          </div>

          {m.title && (
            <div>
              <Label>Title</Label>
              <p className="font-medium">{m.title}</p>
            </div>
          )}

          <div>
            <Label>Content</Label>
            <div className="p-3 bg-muted rounded-lg whitespace-pre-wrap text-sm">
              {m.content}
            </div>
          </div>

          {m.summary && (
            <div>
              <Label>Summary</Label>
              <div className="p-3 bg-muted rounded-lg text-sm">{m.summary}</div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Importance</Label>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${m.importance * 100}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground mt-1">{(m.importance * 100).toFixed(0)}%</p>
            </div>
            <div>
              <Label>Confidence</Label>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500"
                  style={{ width: `${m.confidence * 100}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground mt-1">{(m.confidence * 100).toFixed(0)}%</p>
            </div>
            <div>
              <Label>Version</Label>
              <p>{m.version}</p>
            </div>
            <div>
              <Label>Created</Label>
              <p>{new Date(m.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <Label>Updated</Label>
              <p>{new Date(m.updatedAt).toLocaleString()}</p>
            </div>
            {m.lastAccessedAt && (
              <div>
                <Label>Last Accessed</Label>
                <p>{formatDistanceToNow(new Date(m.lastAccessedAt), { addSuffix: true })}</p>
              </div>
            )}
            {m.expiresAt && (
              <div>
                <Label>Expires</Label>
                <p>{new Date(m.expiresAt).toLocaleString()}</p>
              </div>
            )}
          </div>

          {m.tags.length > 0 && (
            <div>
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-1">
                {m.tags.map((tag) => (
                  <Badge key={tag} variant="outline">{tag}</Badge>
                ))}
              </div>
            </div>
          )}

          {m.entities.length > 0 && (
            <div>
              <Label>Entities</Label>
              <div className="flex flex-wrap gap-1">
                {m.entities.map((entity) => (
                  <Badge key={entity} variant="secondary">{entity}</Badge>
                ))}
              </div>
            </div>
          )}

          {(m.matchedFields?.length ?? 0) > 0 && (
            <div>
              <Label>Matched Fields</Label>
              <div className="flex flex-wrap gap-1">
                {m.matchedFields?.map((field: string) => (
                  <Badge key={field} variant="outline">{field}</Badge>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button variant="ghost" onClick={() => { onArchive(m.id); onClose(); }}>
              <Archive className="size-4 mr-2" /> Archive
            </Button>
            <Button variant="destructive" onClick={() => { onDelete(m.id); onClose(); }}>
              <Trash2 className="size-4 mr-2" /> Delete
            </Button>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function KnowledgeGraphView() {
  const [summary, setSummary] = useState<{
    entityCount: number;
    relationshipCount: number;
    entitiesByType: Record<string, number>;
    topEntities: Array<{ id: string; name: string; type: string; importance: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    try {
      const data = await api.post<typeof summary extends null ? never : NonNullable<typeof summary>>("/api/knowledge-graph", { action: "summary" });
      setSummary(data);
    } catch (err) {
      console.error("Failed to load graph summary:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="size-5" />
            Knowledge Graph
          </CardTitle>
          <CardDescription>Entities and relationships extracted from your memories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 mb-6">
            <StatCard title="Entities" value={summary?.entityCount ?? 0} icon={<Brain className="size-5" />} />
            <StatCard title="Relationships" value={summary?.relationshipCount ?? 0} icon={<Network className="size-5" />} color="green" />
            <StatCard title="Entity Types" value={Object.keys(summary?.entitiesByType ?? {}).length} icon={<Tag className="size-5" />} color="purple" />
          </div>

          <div>
            <h4 className="font-medium mb-3">Entities by Type</h4>
            <div className="flex flex-wrap gap-2">
              {summary && Object.entries(summary.entitiesByType).map(([type, count]) => (
                <Badge key={type} variant="secondary" className="gap-1">
                  {type} <span className="font-mono">{count}</span>
                </Badge>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <h4 className="font-medium mb-3">Top Entities</h4>
            <div className="space-y-2">
              {summary?.topEntities.map((entity) => (
                <div key={entity.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{entity.type}</Badge>
                    <span className="font-medium">{entity.name}</span>
                  </div>
                  <Badge variant="secondary">Importance: {(entity.importance * 100).toFixed(0)}%</Badge>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MemorySettings() {
  const [enabled, setEnabled] = useState(true);
  const [autoExtract, setAutoExtract] = useState(true);
  const [retentionDays, setRetentionDays] = useState(365);
  const [loading, setLoading] = useState(false);

  const saveSettings = async () => {
    setLoading(true);
    try {
      await api.patch("/api/settings", {
        memoryEnabled: enabled,
        memoryAutoExtract: autoExtract,
        memoryRetentionDays: retentionDays,
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="size-5" />
            Memory Settings
          </CardTitle>
          <CardDescription>Configure how AI Nexus manages your long-term memory</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Memory Enabled</Label>
              <p className="text-sm text-muted-foreground">Allow AI Nexus to remember context across conversations</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label>Automatic Extraction</Label>
              <p className="text-sm text-muted-foreground">Automatically extract useful information from conversations</p>
            </div>
            <Switch checked={autoExtract} onCheckedChange={setAutoExtract} />
          </div>

          <Separator />

          <div>
            <Label>Retention Period</Label>
            <p className="text-sm text-muted-foreground">Days to keep memories before auto-archiving (0 = never)</p>
            <Input
              type="number"
              value={retentionDays}
              onChange={(e) => setRetentionDays(parseInt(e.target.value) || 0)}
              min="0"
              max="3650"
              className="w-32 mt-2"
            />
          </div>

          <Button onClick={saveSettings} disabled={loading}>
            {loading ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>Irreversible actions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Delete All Memories</Label>
            <p className="text-sm text-muted-foreground">Permanently delete all your memories. This cannot be undone.</p>
            <Button variant="destructive" className="mt-2" onClick={() => {
              if (confirm("Are you sure you want to delete ALL memories? This cannot be undone.")) {
                toast.error("Not implemented yet");
              }
            }}>
              Delete All Memories
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export { StatCard, MemoryCard, MemoryDetailModal, KnowledgeGraphView, MemorySettings };
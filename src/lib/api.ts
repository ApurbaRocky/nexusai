/**
 * Client-side typed fetch helpers. Server-side logic stays in route handlers.
 */
import type { ResearchRunOutput } from "@/agents/research/research-types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data as { error?: string })?.error ?? "Request failed");
    (err as Error & { code?: string; status?: number }).code = (data as { code?: string })?.code;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(url: string, body?: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  // Conversations
  conversations: () => request<{ conversations: ConversationSummary[] }>("/api/conversations"),
  conversationsForProject: (projectId?: string | null) =>
    request<{ conversations: ConversationSummary[] }>(`/api/conversations${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  createConversation: (body: { title?: string; agentId?: string; model?: string; projectId?: string }) =>
    request<{ id: string; title: string }>("/api/conversations", { method: "POST", body: JSON.stringify(body) }),
  conversation: (id: string) => request<{ conversation: { id: string; title: string; agentId: string | null; model: string | null }; messages: MessageType[] }>(`/api/conversations/${id}`),
  renameConversation: (id: string, title: string) =>
    request<{ ok: boolean }>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteConversation: (id: string) => request<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),

  // Models / agents
  models: () => request<ModelsResponse>("/api/models"),

  // Settings
  settings: () => request<{ profile: { name: string; email: string; role: string }; settings: Record<string, unknown> }>("/api/settings"),
  patchSettings: (body: Record<string, unknown>) =>
    request<{ ok: boolean; settings: Record<string, unknown>; profile?: { name: string } }>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),

  // Memories
  memories: (projectId?: string | null) => request<{ items: MemoryItem[] }>(`/api/memories${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  createMemory: (body: { content: string; type?: string; projectId?: string | null }) =>
    request<{ item: MemoryItem }>("/api/memories", { method: "POST", body: JSON.stringify(body) }),
  updateMemory: (id: string, body: Partial<{ content: string; enabled: boolean; type: string }>) =>
    request<{ item: MemoryItem }>(`/api/memories/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMemory: (id: string) => request<{ ok: boolean }>(`/api/memories/${id}`, { method: "DELETE" }),

  // API keys
  apiKeys: () => request<{ keys: ApiKeyRecord[] }>("/api/api-keys"),
  createApiKey: (body: { provider: string; name: string; apiKey: string }) =>
    request<{ ok: boolean; id: string; provider: string; name: string; last4: string }>("/api/api-keys", { method: "POST", body: JSON.stringify(body) }),
  deleteApiKey: (id: string) => request<{ ok: boolean }>(`/api/api-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Projects
  projects: () => request<{ projects: ProjectSummary[] }>("/api/projects"),
  createProject: (body: { name: string; description?: string }) =>
    request<{ project: { id: string; name: string; description: string } }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  project: (id: string) =>
    request<{ project: ProjectDetail; documents: DocRow[]; conversations: { id: string; title: string; updatedAt: string }[]; memories: { id: string; content: string; type: string }[]; reportCount: number }>(`/api/projects/${id}`),
  deleteProject: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  patchProject: (id: string, body: { name?: string; description?: string }) =>
    request<{ ok: boolean; project: { id: string; name: string; description: string } }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  // Documents
  uploadDocument: async (file: File, projectId?: string | null) => {
    const form = new FormData();
    form.append("file", file);
    if (projectId) form.append("projectId", projectId);
    const res = await fetch("/api/documents", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data as { error?: string })?.error ?? "Upload failed");
    return data as { document: DocRow };
  },
  document: (id: string) => request<{ document: DocRow & { textPreview: string; chunkCount: number; error?: string | null } }>(`/api/documents/${id}`),
  deleteDocument: (id: string) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),

  // Tools
  executeTool: (body: { toolName: string; args: Record<string, unknown>; conversationId?: string | null; projectId?: string | null; documentIds?: string[]; agent?: string | null; confirmed?: boolean }) =>
    request<{ ok: boolean; content: string; data?: unknown; permission: string; riskLevel: string; durationMs?: number; error?: string }>("/api/tools/execute", { method: "POST", body: JSON.stringify(body) }).catch((err) => {
      // Route errors are surfaced as JSON too; normalize.
      const status = (err as { status?: number }).status;
      if (status === 403 || status === 422) {
        return { ok: false, content: (err as Error).message, permission: status === 403 ? "denied" : "error", riskLevel: "medium" };
      }
      throw err;
    }),

  // Research
  research: () => request<{ sessions: ResearchSessionRow[] }>("/api/research"),
  startResearch: (body: { topic: string; goal?: string; projectId?: string | null; mode?: "quick" | "standard" | "deep" }) =>
    request<ResearchRunOutput>("/api/research", { method: "POST", body: JSON.stringify(body) }),
  researchSession: (id: string) => request<{ session: ResearchSessionDetail }>(`/api/research/${id}`),

  // Reports
  reports: () => request<{ reports: { id: string; title: string; format: string; createdAt: string; projectId: string | null }[] }>("/api/reports"),
  createReport: (body: { title: string; content: string; format?: string; projectId?: string | null; conversationId?: string | null; meta?: Record<string, unknown> }) =>
    request<{ id: string; title: string; format: string }>("/api/reports", { method: "POST", body: JSON.stringify(body) }),
  deleteReport: (id: string) => request<{ ok: boolean }>(`/api/reports?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Admin
  adminOverview: () =>
    request<{
      overview: {
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
      };
      tokenUsageByModel: { provider: string; model: string; tokens: number }[];
      recentSecurityEvents: { id: string; action: string; createdAt: string; meta: unknown }[];
      windowDays: number;
    }>("/api/admin/overview"),
};

// Shared row types (mirror backend shapes).
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  agentId?: string | null;
  model?: string | null;
}

export interface MessageType {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  provider?: string | null;
  model?: string | null;
  agent?: string | null;
  status: string;
  error?: string | null;
  attachments?: { name: string; type: string; size?: number }[] | null;
  sources?: { title: string; url: string; provider?: string; snippet?: string; relevance?: number }[] | null;
  tokens?: { prompt?: number; completion?: number; total?: number } | null;
}

export interface ModelRow {
  id: string;
  provider: string;
  label: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  mock: boolean;
  available: boolean;
  reason?: string;
  keySource?: string;
}

export interface ModelsResponse {
  demoEnabled?: boolean;
  models: ModelRow[];
  providers: { id: string; label: string; configured: boolean }[];
  agents: { id: string; name: string; tagline: string; description: string; capabilities: string[]; icon: string }[];
}

export interface MemoryItem {
  id: string;
  type: string;
  content: string;
  source?: string | null;
  enabled: boolean;
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
  matchedFields?: string[];
}

export interface ApiKeyRecord {
  id: string;
  provider: string;
  name: string;
  last4: string;
  isActive: boolean;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  conversationCount: number;
  documentCount: number;
}

export interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocRow {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  createdAt: string;
}

export interface ResearchSessionRow {
  id: string;
  topic: string;
  goal: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  sourceCount: number;
}

export interface ResearchProgressPayload {
  currentStep: string;
  stepsCompleted: string[];
  totalSteps: number;
  sourcesFound: number;
  sourcesAnalyzed: number;
  queriesExecuted: number;
  iterationsCompleted: number;
  percentage: number;
}

export interface ResearchCostPayload {
  searchRequests: number;
  aiRequests: number;
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd: number;
  durationMs: number;
}

export interface ResearchSourceRow {
  id: string;
  title: string;
  url: string;
  domain: string;
  sourceType: string;
  provider: string | null;
  publishedAt: string | null;
  snippet: string | null;
  relevance: number | null;
  verified: boolean;
}

export interface ResearchEvidenceRow {
  sourceId: string;
  excerpt: string;
  url: string;
  relevanceScore: number;
  supports: "supports" | "contradicts" | "neutral";
}

export interface ResearchFindingRow {
  id: string;
  researchQuestionId: string;
  claim: string;
  evidence: ResearchEvidenceRow[];
  sourceIds: string[];
  confidence: string;
  category: string;
  createdAt: string;
}

export interface ResearchConflictSourceRow {
  sourceId: string;
  claim: string;
  excerpt: string;
  url: string;
}

export interface ResearchConflictRow {
  id: string;
  findingId: string;
  description: string;
  sources: ResearchConflictSourceRow[];
  resolution?: string;
}

export interface ResearchSessionDetail {
  id: string;
  topic: string;
  goal: string | null;
  status: string;
  mode: string;
  /** Parsed research plan. Free-form; the UI does not render it yet. */
  plan: unknown;
  /** Markdown body of the synthesized report, or null before synthesis. */
  report: string | null;
  createdAt: string;
  completedAt: string | null;
  sources: ResearchSourceRow[];
  progress: ResearchProgressPayload | null;
  cost: ResearchCostPayload | null;
  findings: ResearchFindingRow[];
  conflicts: ResearchConflictRow[];
}

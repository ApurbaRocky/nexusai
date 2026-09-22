/**
 * Phase 9 — Memory Service
 * Core service for memory operations
 */

import { prisma } from "@/database/client";
import { type AuditContext } from "@/security/audit";
import { log } from "@/utils/log";
import {
  checkMemoryPermission,
  logMemoryAccess,
  validateMemoryOwnership,
} from "./permissions";
import type {
  MemoryType,
  MemoryScope,
  MemorySourceType,
  MemoryPrivacyLevel,
  MemoryStatus,
  MemoryRecord,
  MemoryCreateInput,
  MemoryUpdatePayload,
  MemorySearchQuery,
  MemorySearchResult,
  MemoryContext,
  MemoryProvenance,
} from "./types";
import { MEMORY_TYPE_DEFAULTS } from "./policy";

export class MemoryService {
  private static instance: MemoryService;

  static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService();
    }
    return MemoryService.instance;
  }

  async createMemory(input: MemoryCreateInput, ctx?: AuditContext): Promise<MemoryRecord> {
    // Check permission
    const permission = await checkMemoryPermission({
      userId: input.userId,
      operation: "CREATE",
      scope: input.scope,
      scopeId: input.projectId ?? input.conversationId ?? input.taskId,
    });

    if (!permission.allowed) {
      throw new Error(permission.reason);
    }

    // Get defaults for memory type
    const defaults = MEMORY_TYPE_DEFAULTS[input.type];

    // Build provenance
    const provenance: MemoryProvenance = {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      conversationId: input.conversationId,
      documentId: input.documentId,
      taskId: input.taskId,
      ...input.provenance,
    };

    // Create memory
    const memory = await prisma.memoryRecord.create({
      data: {
        userId: input.userId,
        type: input.type,
        scope: input.scope,
        title: input.title,
        content: input.content,
        summary: input.summary,
        importance: input.importance ?? defaults.defaultImportance,
        confidence: input.confidence ?? defaults.defaultConfidence,
        projectId: input.projectId ?? null,
        conversationId: input.conversationId ?? null,
        taskId: input.taskId ?? null,
        documentId: input.documentId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        provenance: JSON.stringify(provenance),
        tags: input.tags ? JSON.stringify(input.tags) : null,
        entities: input.entities ? JSON.stringify(input.entities) : null,
        privacyLevel: input.privacyLevel ?? defaults.defaultPrivacy,
        userVisible: input.userVisible ?? true,
        userConfirmed: input.userConfirmed ?? false,
        status: "ACTIVE",
        expiresAt: input.expiresAt ?? null,
      },
    });

    // Log access
    await logMemoryAccess(memory.id, input.userId, "CREATE", true, ctx, {
      type: input.type,
      scope: input.scope,
    });

    log.info("memory-created", { memoryId: memory.id, userId: input.userId, type: input.type });

    return this.mapToRecord(memory);
  }

  async getMemory(id: string, userId: string, ctx?: AuditContext): Promise<MemoryRecord | null> {
    const memory = await validateMemoryOwnership(id, userId);
    if (!memory) return null;

    const permission = await checkMemoryPermission({
      userId,
      operation: "READ",
      memory,
    });

    if (!permission.allowed) {
      await logMemoryAccess(id, userId, "READ", false, ctx, { reason: permission.reason });
      return null;
    }

    // Update last accessed
    await prisma.memoryRecord.update({
      where: { id },
      data: { lastAccessedAt: new Date() },
    });

    await logMemoryAccess(id, userId, "READ", true, ctx);

    return this.mapToRecord(memory);
  }

  async updateMemory(
    id: string,
    userId: string,
    payload: MemoryUpdatePayload,
    ctx?: AuditContext
  ): Promise<MemoryRecord | null> {
    const existing = await validateMemoryOwnership(id, userId);
    if (!existing) return null;

    const permission = await checkMemoryPermission({
      userId,
      operation: "UPDATE",
      memory: existing,
    });

    if (!permission.allowed) {
      throw new Error(permission.reason);
    }

    // Create version before update
    await this.createVersion(existing, "user", payload.content ? "Content updated" : "Metadata updated");

    const updated = await prisma.memoryRecord.update({
      where: { id },
      data: {
        content: payload.content ?? existing.content,
        title: payload.title ?? existing.title,
        summary: payload.summary ?? existing.summary,
        importance: payload.importance ?? existing.importance,
        confidence: payload.confidence ?? existing.confidence,
        tags: payload.tags ? JSON.stringify(payload.tags) : JSON.stringify(existing.tags),
        entities: payload.entities ? JSON.stringify(payload.entities) : JSON.stringify(existing.entities),
        privacyLevel: payload.privacyLevel ?? existing.privacyLevel,
        userVisible: payload.userVisible ?? existing.userVisible,
        status: payload.status ?? existing.status,
        expiresAt: payload.expiresAt ?? existing.expiresAt,
        version: existing.version + 1,
      },
    });

    await logMemoryAccess(id, userId, "UPDATE", true, ctx, { changes: Object.keys(payload) });

    log.info("memory-updated", { memoryId: id, userId, changes: Object.keys(payload).join(",") });

    return this.mapToRecord(updated);
  }

  async archiveMemory(id: string, userId: string, ctx?: AuditContext): Promise<boolean> {
    const existing = await validateMemoryOwnership(id, userId);
    if (!existing) return false;

    const permission = await checkMemoryPermission({
      userId,
      operation: "ARCHIVE",
      memory: existing,
    });

    if (!permission.allowed) {
      throw new Error(permission.reason);
    }

    await prisma.memoryRecord.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });

    await logMemoryAccess(id, userId, "ARCHIVE", true, ctx);

    log.info("memory-archived", { memoryId: id, userId });

    return true;
  }

  async deleteMemory(id: string, userId: string, ctx?: AuditContext): Promise<boolean> {
    const existing = await validateMemoryOwnership(id, userId);
    if (!existing) return false;

    const permission = await checkMemoryPermission({
      userId,
      operation: "DELETE",
      memory: existing,
    });

    if (!permission.allowed) {
      throw new Error(permission.reason);
    }

    // Soft delete - mark as DELETED
    await prisma.memoryRecord.update({
      where: { id },
      data: { status: "DELETED" },
    });

    // Remove embedding
    await prisma.memoryEmbedding.deleteMany({ where: { memoryId: id } });

    // Remove tags
    await prisma.memoryTag.deleteMany({ where: { memoryId: id } });

    await logMemoryAccess(id, userId, "DELETE", true, ctx);

    log.info("memory-deleted", { memoryId: id, userId });

    return true;
  }

  async searchMemories(query: MemorySearchQuery, ctx?: AuditContext): Promise<MemorySearchResult[]> {
    const permission = await checkMemoryPermission({
      userId: query.userId,
      operation: "SEARCH",
      scope: query.scopes?.[0],
      scopeId: query.projectId ?? query.conversationId ?? query.taskId,
    });

    if (!permission.allowed) {
      await logMemoryAccess("search", query.userId, "SEARCH", false, ctx, { reason: permission.reason });
      return [];
    }

    const where: Record<string, unknown> = {
      userId: query.userId,
      status: query.includeArchived ? { in: ["ACTIVE", "ARCHIVED"] } : "ACTIVE",
    };

    if (!query.includeExpired) {
      where.expiresAt = { gte: new Date() };
    }

    if (query.types?.length) {
      where.type = { in: query.types };
    }

    if (query.scopes?.length) {
      where.scope = { in: query.scopes };
    }

    if (query.projectId) {
      where.projectId = query.projectId;
    }

    if (query.conversationId) {
      where.conversationId = query.conversationId;
    }

    if (query.taskId) {
      where.taskId = query.taskId;
    }

    if (query.minImportance) {
      where.importance = { gte: query.minImportance };
    }

    if (query.minConfidence) {
      where.confidence = { gte: query.minConfidence };
    }

    const memories = await prisma.memoryRecord.findMany({
      where,
      orderBy: [
        { importance: "desc" },
        { confidence: "desc" },
        { updatedAt: "desc" },
      ],
      take: query.maxResults ?? 20,
    });

    // Filter by tags and entities in memory
    let filtered = memories.map((m) => this.mapToRecord(m));

    if (query.tags?.length) {
      filtered = filtered.filter((m) => query.tags!.some((t) => m.tags.includes(t)));
    }

    if (query.entities?.length) {
      filtered = filtered.filter((m) => query.entities!.some((e) => m.entities.includes(e)));
    }

    // Simple text search scoring
    const results: MemorySearchResult[] = filtered.map((memory) => {
      let score = memory.importance * 0.5 + memory.confidence * 0.3;
      const matchedFields: string[] = [];

      if (query.query) {
        const lowerQuery = query.query.toLowerCase();
        if (memory.content.toLowerCase().includes(lowerQuery)) {
          score += 0.3;
          matchedFields.push("content");
        }
        if (memory.title?.toLowerCase().includes(lowerQuery)) {
          score += 0.2;
          matchedFields.push("title");
        }
        if (memory.summary?.toLowerCase().includes(lowerQuery)) {
          score += 0.1;
          matchedFields.push("summary");
        }
        if (memory.tags.some((t) => t.toLowerCase().includes(lowerQuery))) {
          score += 0.15;
          matchedFields.push("tags");
        }
      }

      return { memory, score, matchedFields };
    });

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    await logMemoryAccess("search", query.userId, "SEARCH", true, ctx, {
      resultCount: results.length,
      query: query.query,
    });

    return results;
  }

  async getMemoriesForContext(
    userId: string,
    options: {
      projectId?: string;
      conversationId?: string;
      taskId?: string;
      maxTokens?: number;
      maxMemories?: number;
      minImportance?: number;
    } = {}
  ): Promise<MemoryContext> {
    const { projectId, conversationId, taskId, maxTokens = 2000, maxMemories = 10, minImportance = 0.3 } = options;

    const results = await this.searchMemories({
      userId,
      projectId,
      conversationId,
      taskId,
      query: "",
      minImportance,
      maxResults: maxMemories * 2, // Get more for ranking
      includeArchived: false,
    });

    // Rank by relevance
    const ranked = this.rankMemories(results, {
      projectId,
      conversationId,
      taskId,
    });

    // Select within token budget
    let totalTokens = 0;
    const selected: MemoryRecord[] = [];

    for (const result of ranked) {
      const memory = result.memory;
      const tokens = this.estimateTokens(memory.content) + (memory.summary ? this.estimateTokens(memory.summary) : 0);

      if (totalTokens + tokens > maxTokens || selected.length >= maxMemories) {
        break;
      }

      selected.push(memory);
      totalTokens += tokens;
    }

    return {
      memories: selected,
      totalTokens,
      truncated: selected.length < ranked.length,
    };
  }

  private rankMemories(
    results: MemorySearchResult[],
    context: { projectId?: string; conversationId?: string; taskId?: string }
  ): MemorySearchResult[] {
    return results.map((result) => {
      let score = result.score;
      const memory = result.memory;

      // Boost for scope match
      if (context.projectId && memory.projectId === context.projectId) score += 0.2;
      if (context.conversationId && memory.conversationId === context.conversationId) score += 0.15;
      if (context.taskId && memory.taskId === context.taskId) score += 0.15;

      // Boost for recency
      const daysSinceUpdate = (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < 1) score += 0.1;
      else if (daysSinceUpdate < 7) score += 0.05;

      // Boost for user confirmed
      if (memory.userConfirmed) score += 0.1;

      return { ...result, score };
    }).sort((a, b) => b.score - a.score);
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  private async createVersion(
    memory: MemoryRecord,
    changedBy: "user" | "agent" | "system" | "extraction",
    changeReason?: string
  ): Promise<void> {
    await prisma.memoryVersion.create({
      data: {
        memoryId: memory.id,
        userId: memory.userId,
        content: memory.content,
        summary: memory.summary,
        importance: memory.importance,
        confidence: memory.confidence,
        tags: JSON.stringify(memory.tags),
        entities: JSON.stringify(memory.entities),
        changedBy,
        changeReason: changeReason ?? null,
        version: memory.version,
      },
    });
  }

  async getMemoryVersions(id: string, userId: string): Promise<MemoryRecord[]> {
    const memory = await validateMemoryOwnership(id, userId);
    if (!memory) return [];

    const versions = await prisma.memoryVersion.findMany({
      where: { memoryId: id },
      orderBy: { version: "desc" },
    });

    return versions.map((v) => ({
      ...v,
      tags: v.tags ? JSON.parse(v.tags) : [],
      entities: v.entities ? JSON.parse(v.entities) : [],
      provenance: null,
      scope: memory.scope,
      type: memory.type,
      createdAt: new Date(v.createdAt),
      updatedAt: new Date(v.createdAt),
    })) as unknown as MemoryRecord[];
  }

  async getMemoryStats(userId: string): Promise<{
    total: number;
    active: number;
    archived: number;
    byType: Record<string, number>;
    byScope: Record<string, number>;
    avgImportance: number;
    avgConfidence: number;
  }> {
    const memories = await prisma.memoryRecord.findMany({
      where: { userId, status: { in: ["ACTIVE", "ARCHIVED"] } },
    });

    const byType: Record<string, number> = {};
    const byScope: Record<string, number> = {};
    let totalImportance = 0;
    let totalConfidence = 0;

    for (const m of memories) {
      byType[m.type] = (byType[m.type] ?? 0) + 1;
      byScope[m.scope] = (byScope[m.scope] ?? 0) + 1;
      totalImportance += m.importance;
      totalConfidence += m.confidence;
    }

    return {
      total: memories.length,
      active: memories.filter((m) => m.status === "ACTIVE").length,
      archived: memories.filter((m) => m.status === "ARCHIVED").length,
      byType,
      byScope,
      avgImportance: memories.length > 0 ? totalImportance / memories.length : 0,
      avgConfidence: memories.length > 0 ? totalConfidence / memories.length : 0,
    };
  }

  private mapToRecord(row: NonNullable<Awaited<ReturnType<typeof prisma.memoryRecord.findUnique>>> | MemoryRecord): MemoryRecord {
    const source = row as NonNullable<Awaited<ReturnType<typeof prisma.memoryRecord.findUnique>>>;
    return {
      id: source.id, userId: source.userId, projectId: source.projectId, conversationId: source.conversationId,
      taskId: source.taskId, documentId: source.documentId, type: source.type as MemoryType, scope: source.scope as MemoryScope,
      title: source.title, content: source.content, summary: source.summary, importance: source.importance, confidence: source.confidence,
      sourceType: source.sourceType as MemorySourceType, sourceId: source.sourceId,
      provenance: source.provenance ? JSON.parse(source.provenance) : null,
      embedding: source.embedding ? JSON.parse(source.embedding) : null,
      tags: source.tags ? JSON.parse(source.tags) : [], entities: source.entities ? JSON.parse(source.entities) : [],
      privacyLevel: source.privacyLevel as MemoryPrivacyLevel, userVisible: source.userVisible, userConfirmed: source.userConfirmed,
      status: source.status as MemoryStatus, version: source.version, createdAt: source.createdAt, updatedAt: source.updatedAt,
      lastAccessedAt: source.lastAccessedAt, expiresAt: source.expiresAt,
    };
  }
}

// Export singleton instance
export const memoryService = MemoryService.getInstance();

// Legacy compatibility functions
export async function listMemories(userId: string, projectId?: string) {
  const results = await memoryService.searchMemories({
    userId,
    projectId,
    query: "",
    maxResults: 100,
    includeArchived: true,
  });
  return results.map((result) => result.memory);
}

export async function addMemory(
  userId: string,
  input: { content: string; type?: MemoryType | "project" | "preference" | "long_term"; projectId?: string; source?: string }
) {
  return memoryService.createMemory({
    userId,
    type: input.type === "project" ? "PROJECT" : input.type === "preference" ? "PREFERENCE" : "CONVERSATION",
    scope: input.projectId ? "PROJECT" : "GLOBAL_USER",
    content: input.content,
    sourceType: "conversation",
    projectId: input.projectId,
    provenance: { sourceType: "conversation", sourceId: input.source },
  });
}

export async function updateMemory(
  userId: string,
  id: string,
  patch: { content?: string; enabled?: boolean; type?: MemoryType | "project" | "preference" | "long_term" }
) {
  return memoryService.updateMemory(id, userId, {
    content: patch.content,
    status: patch.enabled === false ? "ARCHIVED" : undefined,
  });
}

export async function deleteMemory(userId: string, id: string) {
  return memoryService.deleteMemory(id, userId);
}

export async function memoryBlockText(userId: string, projectId?: string, limit = 4000): Promise<string> {
  const context = await memoryService.getMemoriesForContext(userId, {
    projectId,
    maxTokens: limit,
    maxMemories: 20,
  });

  if (!context.memories.length) return "";

  const header = projectId ? "Project memories:" : "Long-term memories:";
  const text = context.memories
    .map((m, i) => `${i + 1}. (${m.type}) ${m.content}`)
    .join("\n");

  return `${header}\n${text}`.slice(0, limit);
}
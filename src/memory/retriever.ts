/**
 * Phase 9 — Memory Retriever
 * Hybrid search combining keyword, semantic, and graph-based retrieval
 */

import { prisma } from "@/database/client";
import { getEmbeddingProvider } from "@/rag/embeddings";
import { memoryService } from "./service";
import { log } from "@/utils/log";
import type {
  MemoryRecord,
  MemorySearchQuery,
  MemorySearchResult,
  MemoryContext,
  MemoryScope,
  MemoryType,
} from "./types";

export interface RetrievalOptions {
  query: string;
  userId: string;
  projectId?: string;
  conversationId?: string;
  taskId?: string;
  types?: MemoryType[];
  scopes?: MemoryScope[];
  maxResults?: number;
  minScore?: number;
  includeGraph?: boolean;
  tokenBudget?: number;
}

export interface RetrievalResult {
  memories: MemoryRecord[];
  scores: Map<string, number>;
  totalCandidates: number;
  retrievalTimeMs: number;
}

export class MemoryRetriever {
  private keywordWeight = 0.3;
  private semanticWeight = 0.5;
  private recencyWeight = 0.1;
  private importanceWeight = 0.1;

  async retrieve(options: RetrievalOptions): Promise<RetrievalResult> {
    const startTime = Date.now();
    const {
      query,
      userId,
      projectId,
      conversationId,
      taskId,
      types,
      scopes,
      maxResults = 20,
      minScore = 0.3,
      includeGraph = true,
      tokenBudget = 3000,
    } = options;

    // 1. Keyword search
    const keywordResults = await this.keywordSearch({
      query,
      userId,
      projectId,
      conversationId,
      taskId,
      types,
      scopes,
      maxResults: maxResults * 2,
    });

    // 2. Semantic search (if query is substantial)
    let semanticResults: MemorySearchResult[] = [];
    if (query.length > 10) {
      semanticResults = await this.semanticSearch({
        query,
        userId,
        projectId,
        conversationId,
        taskId,
        types,
        scopes,
        maxResults: maxResults * 2,
      });
    }

    // 3. Graph-based retrieval (if enabled)
    let graphResults: MemorySearchResult[] = [];
    if (includeGraph) {
      graphResults = await this.graphSearch({
        query,
        userId,
        projectId,
        conversationId,
        taskId,
        maxResults: maxResults,
      });
    }

    // 4. Combine and rank
    const combined = this.combineResults(keywordResults, semanticResults, graphResults);

    // 5. Apply minimum score filter
    const filtered = combined.filter((r) => r.score >= minScore);

    // 6. Select within token budget
    const selected = this.selectWithinBudget(filtered, tokenBudget, maxResults);

    const retrievalTimeMs = Date.now() - startTime;

    log.info("memory-retrieval-complete", {
      userId,
      query: query.slice(0, 50),
      keywordCount: keywordResults.length,
      semanticCount: semanticResults.length,
      graphCount: graphResults.length,
      finalCount: selected.length,
      retrievalTimeMs,
    });

    return {
      memories: selected.map((r) => r.memory),
      scores: new Map(selected.map((r) => [r.memory.id, r.score])),
      totalCandidates: combined.length,
      retrievalTimeMs,
    };
  }

  private async keywordSearch(options: MemorySearchQuery): Promise<MemorySearchResult[]> {
    return memoryService.searchMemories(options);
  }

  private async semanticSearch(options: MemorySearchQuery): Promise<MemorySearchResult[]> {
    try {
      // Generate embedding for query
      const provider = await getEmbeddingProvider();
      const queryEmbedding = (await provider.embed([options.query ?? ""]))[0];

      // Find memories with embeddings
      const memories = await prisma.memoryRecord.findMany({
        where: {
          userId: options.userId,
          status: "ACTIVE",
          embedding: { not: null },
          ...(options.projectId ? { projectId: options.projectId } : {}),
          ...(options.conversationId ? { conversationId: options.conversationId } : {}),
          ...(options.taskId ? { taskId: options.taskId } : {}),
          ...(options.types?.length ? { type: { in: options.types } } : {}),
          ...(options.scopes?.length ? { scope: { in: options.scopes } } : {}),
        },
        take: options.maxResults ?? 50,
      });

      // Calculate cosine similarity
      const results: MemorySearchResult[] = [];
      for (const memory of memories) {
        if (!memory.embedding) continue;
        const memEmbedding = JSON.parse(memory.embedding) as number[];
        const similarity = this.cosineSimilarity(queryEmbedding, memEmbedding);

        if (similarity > 0.3) {
          const record = await memoryService.getMemory(memory.id, options.userId);
          if (record) {
            results.push({
              memory: record,
              score: similarity,
              matchedFields: ["semantic"],
            });
          }
        }
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, options.maxResults ?? 20);
    } catch (err) {
      log.error("semantic-search-failed", { error: (err as Error).message });
      return [];
    }
  }

  private async graphSearch(options: {
    query: string;
    userId: string;
    projectId?: string;
    conversationId?: string;
    taskId?: string;
    maxResults: number;
  }): Promise<MemorySearchResult[]> {
    try {
      // Extract entities from query
      const entities = this.extractEntitiesFromQuery(options.query);

      if (entities.length === 0) return [];

      // Find knowledge entities matching query entities
      const knowledgeEntities = await prisma.knowledgeEntity.findMany({
        where: {
          userId: options.userId,
          status: "ACTIVE",
          OR: entities.map((e) => ({ name: { contains: e, mode: "insensitive" } })),
        },
        take: 20,
      });

      if (knowledgeEntities.length === 0) return [];

      // Find memories linked to these entities
      const entityIds = knowledgeEntities.map((e) => e.id);
      const memoryIds = await prisma.memoryRecord.findMany({
        where: {
          userId: options.userId,
          status: "ACTIVE",
          graphEntities: { some: { id: { in: entityIds } } },
          ...(options.projectId ? { projectId: options.projectId } : {}),
        },
        select: { id: true },
        take: options.maxResults,
      });

      const results: MemorySearchResult[] = [];
      for (const m of memoryIds) {
        const record = await memoryService.getMemory(m.id, options.userId);
        if (record) {
          results.push({
            memory: record,
            score: 0.7, // Base graph score
            matchedFields: ["graph"],
          });
        }
      }

      return results;
    } catch (err) {
      log.error("graph-search-failed", { error: (err as Error).message });
      return [];
    }
  }

  private extractEntitiesFromQuery(query: string): string[] {
    // Simple entity extraction - in production use NER
    const words = query.split(/\s+/).filter((w) => w.length > 2);
    return words;
  }

  private combineResults(
    keyword: MemorySearchResult[],
    semantic: MemorySearchResult[],
    graph: MemorySearchResult[]
  ): MemorySearchResult[] {
    const combined = new Map<string, MemorySearchResult>();

    // Add keyword results
    for (const r of keyword) {
      combined.set(r.memory.id, { ...r, score: r.score * this.keywordWeight });
    }

    // Add semantic results
    for (const r of semantic) {
      const existing = combined.get(r.memory.id);
      if (existing) {
        existing.score += r.score * this.semanticWeight;
        existing.matchedFields.push(...r.matchedFields);
      } else {
        combined.set(r.memory.id, { ...r, score: r.score * this.semanticWeight });
      }
    }

    // Add graph results
    for (const r of graph) {
      const existing = combined.get(r.memory.id);
      if (existing) {
        existing.score += r.score * 0.2; // Graph boost
        existing.matchedFields.push(...r.matchedFields);
      } else {
        combined.set(r.memory.id, { ...r, score: r.score * 0.2 });
      }
    }

    // Apply recency and importance boosts
    const results = Array.from(combined.values());
    for (const r of results) {
      const memory = r.memory;

      // Recency boost
      const daysSinceUpdate = (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < 1) r.score += this.recencyWeight;
      else if (daysSinceUpdate < 7) r.score += this.recencyWeight * 0.5;

      // Importance boost
      r.score += memory.importance * this.importanceWeight;

      // User confirmed boost
      if (memory.userConfirmed) r.score += 0.05;
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  private selectWithinBudget(
    results: MemorySearchResult[],
    tokenBudget: number,
    maxResults: number
  ): MemorySearchResult[] {
    const selected: MemorySearchResult[] = [];
    let totalTokens = 0;

    for (const result of results) {
      const memory = result.memory;
      const tokens = this.estimateTokens(memory.content) + (memory.summary ? this.estimateTokens(memory.summary) : 0);

      if (totalTokens + tokens > tokenBudget || selected.length >= maxResults) {
        break;
      }

      selected.push(result);
      totalTokens += tokens;
    }

    return selected;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // Get context for a specific agent/task
  async getContextForAgent(
    userId: string,
    agentId: string,
    options: {
      projectId?: string;
      conversationId?: string;
      taskId?: string;
      query?: string;
    } = {}
  ): Promise<MemoryContext> {
    // Agent-specific scope filtering
    const agentScopes: Record<string, MemoryScope[]> = {
      general: ["GLOBAL_USER", "CONVERSATION"],
      research: ["GLOBAL_USER", "PROJECT", "DOCUMENT_COLLECTION"],
      education: ["GLOBAL_USER", "PROJECT"],
      security: ["GLOBAL_USER", "PROJECT"],
      coding: ["GLOBAL_USER", "PROJECT", "TASK"],
      document: ["GLOBAL_USER", "PROJECT", "DOCUMENT_COLLECTION"],
      rag: ["GLOBAL_USER", "PROJECT", "DOCUMENT_COLLECTION"],
      report: ["GLOBAL_USER", "PROJECT", "DOCUMENT_COLLECTION", "TASK"],
      browser: ["GLOBAL_USER", "SESSION"],
    };

    const allowedScopes = agentScopes[agentId] ?? ["GLOBAL_USER"];

    const retrieval = await this.retrieve({
      query: options.query ?? "",
      userId,
      projectId: options.projectId,
      conversationId: options.conversationId,
      taskId: options.taskId,
      scopes: allowedScopes,
      maxResults: 15,
      tokenBudget: 2000,
    });

    return {
      memories: retrieval.memories,
      totalTokens: retrieval.memories.reduce((sum, m) => sum + this.estimateTokens(m.content), 0),
      truncated: retrieval.memories.length < retrieval.totalCandidates,
    };
  }
}

export const memoryRetriever = new MemoryRetriever();
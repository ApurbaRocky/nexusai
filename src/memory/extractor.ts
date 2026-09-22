/**
 * Phase 9 — Memory Extractor
 * Intelligent extraction of memory candidates from conversations and other sources
 */

import { memoryService } from "./service";
import { detectSecrets, sanitizeForMemory } from "./policy";
import { getProvider } from "@/ai/providers/registry";
import { resolveKeySource } from "@/security/api-key-resolver";
import { lookupModel } from "@/ai/model-catalog";
import { log } from "@/utils/log";
import type {
  MemoryType,
  MemoryScope,
  MemoryExtractionCandidate,
  MemoryExtractionResult,
  MemoryProvenance,
  MemoryRecord,
} from "./types";

const EXTRACTION_PROMPT = `You are an AI memory extraction specialist. Your task is to analyze a conversation and identify information that would be useful for the AI to remember long-term.

EXTRACTION RULES:
1. Only extract DURABLE, USEFUL information that would help in future interactions
2. Do NOT extract: temporary state, one-time facts, sensitive personal information unless explicitly requested
3. Focus on: preferences, project details, recurring patterns, important decisions, user traits
4. Each extraction must have a confidence score (0-1) and importance score (0-1)

MEMORY TYPES:
- USER_PROFILE: Stable user characteristics (role, expertise, communication style)
- PREFERENCE: User preferences (language, format, style, tools)
- PROJECT: Project-specific information (architecture, decisions, constraints)
- CONVERSATION: Context from conversations that spans multiple sessions
- TASK: Task-specific context (goals, progress, blockers)
- DOCUMENT: Key insights from documents
- RESEARCH: Research findings and conclusions
- EDUCATION: Learning progress, goals, weak areas
- CODING: Coding conventions, architecture decisions, tech stack
- BROWSER: Approved browsing patterns, workflows

SCOPES:
- GLOBAL_USER: Applies across all projects/conversations
- PROJECT: Specific to a project
- CONVERSATION: Specific to a conversation thread
- TASK: Specific to a task
- DOCUMENT_COLLECTION: Specific to a document collection
- AGENT: Specific to an agent
- SESSION: Temporary, single-session only

Return JSON array of extraction candidates with:
{
  "content": "extracted memory content",
  "type": "MEMORY_TYPE",
  "scope": "MEMORY_SCOPE",
  "importance": 0.0-1.0,
  "confidence": 0.0-1.0,
  "entities": ["entity1", "entity2"],
  "tags": ["tag1", "tag2"],
  "reasoning": "why this is useful to remember"
}`;

interface ExtractionInput {
  conversationId: string;
  userId: string;
  messages: Array<{ role: string; content: string }>;
  projectId?: string;
  agentId?: string;
  modelId?: string;
}

export class MemoryExtractor {
  async extractFromConversation(input: ExtractionInput): Promise<MemoryExtractionResult> {
    const { conversationId, userId, messages, projectId, agentId, modelId } = input;

    // Get last N messages for extraction (avoid reprocessing entire history)
    const recentMessages = messages.slice(-20);
    const conversationText = recentMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    if (conversationText.length < 100) {
      return { candidates: [], filteredCount: 0, duplicatesFound: 0, sensitiveFiltered: 0 };
    }

    // Use AI to extract candidates
    const candidates = await this.extractWithAI(conversationText, {
      conversationId,
      userId,
      projectId,
      agentId,
      modelId,
    });

    // Filter candidates
    const filtered = await this.filterCandidates(candidates, userId);

    log.info("memory-extraction-complete", {
      conversationId,
      userId,
      totalCandidates: candidates.length,
      filteredCount: filtered.filteredCount,
      duplicatesFound: filtered.duplicatesFound,
      sensitiveFiltered: filtered.sensitiveFiltered,
    });

    return filtered;
  }

  private async extractWithAI(
    text: string,
    context: { conversationId: string; userId: string; projectId?: string; agentId?: string; modelId?: string }
  ): Promise<MemoryExtractionCandidate[]> {
    const model = context.modelId ? lookupModel(context.modelId) : lookupModel("gpt-4o-mini");
    if (!model) return [];

    const key = await resolveKeySource(context.userId, model.provider);
    const provider = getProvider(model.provider, key.apiKey);

    const prompt = `${EXTRACTION_PROMPT}

CONVERSATION:
${text}

CONTEXT:
- Conversation ID: ${context.conversationId}
- Project ID: ${context.projectId ?? "none"}
- Agent ID: ${context.agentId ?? "general"}

Return ONLY a JSON array of extraction candidates.`;

    try {
      const response = await provider.complete({
        model: provider.listModels().find((candidate) => candidate.id === model.id) ?? provider.listModels()[0],
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 2000,
      });

      const content = response.content.trim();
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.map((c: Record<string, unknown>) => ({
        content: c.content,
        type: c.type as MemoryType,
        scope: c.scope as MemoryScope,
        importance: Math.min(1, Math.max(0, Number(c.importance ?? 0.5))),
        confidence: Math.min(1, Math.max(0, Number(c.confidence ?? 0.5))),
        entities: Array.isArray(c.entities) ? c.entities : [],
        tags: Array.isArray(c.tags) ? c.tags : [],
        provenance: {
          sourceType: "conversation",
          sourceId: context.conversationId,
          conversationId: context.conversationId,
          agentId: context.agentId,
          extractedAt: new Date(),
          extractionConfidence: c.confidence ?? 0.5,
        } as MemoryProvenance,
      }));
    } catch (err) {
      log.error("memory-extraction-ai-failed", { error: (err as Error).message });
      return [];
    }
  }

  private async filterCandidates(
    candidates: MemoryExtractionCandidate[],
    userId: string
  ): Promise<MemoryExtractionResult> {
    let filteredCount = 0;
    let duplicatesFound = 0;
    let sensitiveFiltered = 0;
    const valid: MemoryExtractionCandidate[] = [];

    for (const candidate of candidates) {
      // Check for secrets
      const secrets = detectSecrets(candidate.content);
      if (secrets.length > 0) {
        sensitiveFiltered++;
        log.warn("memory-extraction-secret-detected", { candidate: candidate.content.slice(0, 100), secrets: secrets.join(",") });
        continue;
      }

      // Check for sensitive categories
      const contentLower = candidate.content.toLowerCase();
      let isSensitive = false;
      for (const category of ["health", "mental health", "sexuality", "religion", "political", "financial", "government id"]) {
        if (contentLower.includes(category)) {
          isSensitive = true;
          break;
        }
      }
      if (isSensitive) {
        sensitiveFiltered++;
        continue;
      }

      // Sanitize content
      candidate.content = sanitizeForMemory(candidate.content);

      // Check for duplicates with existing memories
      const existing = await memoryService.searchMemories({
        userId,
        query: candidate.content,
        maxResults: 5,
        minImportance: 0.3,
      });

      const isDuplicate = existing.some((r) => r.score > 0.85);
      if (isDuplicate) {
        duplicatesFound++;
        continue;
      }

      valid.push(candidate);
    }

    filteredCount = candidates.length - valid.length;

    return {
      candidates: valid,
      filteredCount,
      duplicatesFound,
      sensitiveFiltered,
    };
  }

  async extractFromDocument(
    documentId: string,
    userId: string,
    content: string,
    projectId?: string
  ): Promise<MemoryExtractionResult> {
    const chunks = this.chunkText(content, 3000);
    const allCandidates: MemoryExtractionCandidate[] = [];

    for (const chunk of chunks.slice(0, 5)) { // Limit to first 5 chunks
      const candidates = await this.extractWithAI(chunk, {
        conversationId: `document:${documentId}`,
        userId,
        projectId,
      });

      // Update provenance for document source
      for (const c of candidates) {
        c.provenance = {
          ...c.provenance,
          sourceType: "document",
          sourceId: documentId,
        };
        c.type = "DOCUMENT";
        c.scope = "DOCUMENT_COLLECTION";
      }
      allCandidates.push(...candidates);
    }

    return this.filterCandidates(allCandidates, userId);
  }

  async extractFromResearch(
    researchSessionId: string,
    userId: string,
    findings: string,
    projectId?: string
  ): Promise<MemoryExtractionResult> {
    const candidates = await this.extractWithAI(findings, {
      conversationId: `research:${researchSessionId}`,
      userId,
      projectId,
    });

    for (const c of candidates) {
      c.provenance = {
        ...c.provenance,
        sourceType: "research",
        sourceId: researchSessionId,
      };
      c.type = "RESEARCH";
      c.scope = "GLOBAL_USER";
    }

    return this.filterCandidates(candidates, userId);
  }

  async extractFromTask(
    taskId: string,
    userId: string,
    taskDescription: string,
    projectId?: string
  ): Promise<MemoryExtractionResult> {
    const candidates = await this.extractWithAI(taskDescription, {
      conversationId: `task:${taskId}`,
      userId,
      projectId,
    });

    for (const c of candidates) {
      c.provenance = {
        ...c.provenance,
        sourceType: "task",
        sourceId: taskId,
      };
      c.type = "TASK";
      c.scope = "TASK";
    }

    return this.filterCandidates(candidates, userId);
  }

  private chunkText(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxLength) {
      chunks.push(text.slice(i, i + maxLength));
    }
    return chunks;
  }

  // Explicit memory commands
  async handleExplicitMemoryCommand(
    userId: string,
    command: string,
    context: { projectId?: string; conversationId?: string }
  ): Promise<{ saved: boolean; memory?: MemoryRecord; message: string }> {

    // "Remember that..." or "Save this..." or "Don't forget..."
    const rememberMatch = command.match(/(?:remember|save|don't forget|keep in mind)\s+(?:that\s+)?(.+)/i);
    if (rememberMatch) {
      const content = rememberMatch[1].trim();
      const memory = await memoryService.createMemory({
        userId,
        type: "PREFERENCE",
        scope: context.projectId ? "PROJECT" : "GLOBAL_USER",
        content,
        sourceType: "user_explicit",
        sourceId: context.conversationId,
        provenance: {
          sourceType: "user_explicit",
          sourceId: context.conversationId,
          userConfirmed: true,
        },
        userConfirmed: true,
        importance: 0.8,
        confidence: 0.9,
      });
      return { saved: true, memory, message: "Memory saved." };
    }

    // "Forget that..." or "Delete memory..."
    const forgetMatch = command.match(/(?:forget|delete memory|remove memory)\s+(?:that\s+)?(.+)/i);
    if (forgetMatch) {
      const query = forgetMatch[1].trim();
      const results = await memoryService.searchMemories({
        userId,
        query,
        maxResults: 1,
      });
      if (results.length > 0) {
        await memoryService.deleteMemory(results[0].memory.id, userId);
        return { saved: false, message: "Memory deleted." };
      }
      return { saved: false, message: "No matching memory found." };
    }

    // "What do you remember about..."
    const recallMatch = command.match(/(?:what do you remember|what do you know)\s+(?:about\s+)?(.+)/i);
    if (recallMatch) {
      const query = recallMatch[1].trim();
      const results = await memoryService.searchMemories({
        userId,
        query,
        maxResults: 5,
      });
      if (results.length > 0) {
        return {
          saved: false,
          message: results.map((r) => `- ${r.memory.content}`).join("\n"),
        };
      }
      return { saved: false, message: "I don't have any memories about that." };
    }

    return { saved: false, message: "Unknown memory command." };
  }
}

export const memoryExtractor = new MemoryExtractor();
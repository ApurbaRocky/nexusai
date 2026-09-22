import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryService } from "@/memory/service";
import { memoryExtractor } from "@/memory/extractor";
import { memoryRetriever } from "@/memory/retriever";
import { knowledgeGraphService } from "@/memory/knowledge-graph";
import { detectSecrets, sanitizeForMemory, isSensitiveCategory } from "@/memory/policy";
import { prisma } from "@/database/client";

vi.mock("@/database/client", () => ({
  prisma: {
    memoryRecord: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    memoryVersion: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    memoryEmbedding: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    memoryTag: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    memoryAccessLog: {
      create: vi.fn(),
    },
    knowledgeEntity: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    knowledgeRelationship: {
      create: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    knowledgeEvidence: {
      create: vi.fn(),
    },
    memoryExport: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/security/audit", () => ({
  audit: vi.fn(),
}));

vi.mock("@/utils/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/ai/providers/registry", () => ({
  getProvider: vi.fn(),
  getAvailableModels: vi.fn(),
}));

vi.mock("@/security/api-key-resolver", () => ({
  resolveKeySource: vi.fn(),
}));

vi.mock("@/ai/model-catalog", () => ({
  lookupModel: vi.fn(),
}));

vi.mock("@/rag/embeddings", () => ({
  getEmbedding: vi.fn(),
}));

vi.mock("@/memory/permissions", () => ({
  checkMemoryPermission: vi.fn().mockResolvedValue({
    allowed: true,
    reason: "Permission granted",
    requiresApproval: false,
    ruleIds: [],
  }),
  logMemoryAccess: vi.fn(),
  validateMemoryOwnership: vi.fn().mockResolvedValue({
    id: "mem-1",
    userId: "user-1",
    type: "PREFERENCE",
    scope: "GLOBAL_USER",
    content: "I like TypeScript",
    title: null,
    summary: null,
    importance: 0.8,
    confidence: 0.9,
    projectId: null,
    conversationId: "conv-1",
    taskId: null,
    documentId: null,
    sourceType: "user_explicit",
    sourceId: "conv-1",
    provenance: JSON.stringify({ sourceType: "user_explicit", sourceId: "conv-1", userConfirmed: true }),
    tags: JSON.stringify([]),
    entities: JSON.stringify([]),
    privacyLevel: "NORMAL",
    userVisible: true,
    userConfirmed: true,
    status: "ACTIVE",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: null,
    expiresAt: null,
  }),
}));

describe("Memory Policy", () => {
  describe("detectSecrets", () => {
    it("detects OpenAI API keys", () => {
      const content = "My key is sk-abcdefghijklmnopqrstuvwxyz123456";
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
    });

    it("detects Anthropic API keys", () => {
      const content = "Key: sk-ant-abcdefghijklmnopqrstuvwxyz123456789012345678901234567890";
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
    });

    it("detects JWT tokens", () => {
      const content = "Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
    });

    it("detects passwords", () => {
      const content = 'password = "mySecretPassword123"';
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
    });

    it("detects credit card numbers", () => {
      const content = "Card: 4111-1111-1111-1111";
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
    });

    it("returns empty for clean content", () => {
      const content = "This is a normal sentence without secrets.";
      const secrets = detectSecrets(content);
      expect(secrets.length).toBe(0);
    });
  });

  describe("sanitizeForMemory", () => {
    it("redacts API keys", () => {
      const content = "My key is sk-abcdefghijklmnopqrstuvwxyz123456";
      const sanitized = sanitizeForMemory(content);
      expect(sanitized).toContain("[REDACTED]");
      expect(sanitized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    });

    it("redacts multiple secrets", () => {
      const content = "Key1: sk-11111111111111111111111111111111 Key2: sk-22222222222222222222222222222222";
      const sanitized = sanitizeForMemory(content);
      const redactedCount = (sanitized.match(/\[REDACTED\]/g) || []).length;
      expect(redactedCount).toBe(2);
    });
  });

  describe("isSensitiveCategory", () => {
    it("detects health content", () => {
      expect(isSensitiveCategory("health")).toBe(true);
      expect(isSensitiveCategory("mental health")).toBe(true);
    });

    it("detects financial content", () => {
      expect(isSensitiveCategory("financial")).toBe(true);
      expect(isSensitiveCategory("financial account")).toBe(true);
    });

    it("detects religion content", () => {
      expect(isSensitiveCategory("religion")).toBe(true);
    });

    it("returns false for non-sensitive", () => {
      expect(isSensitiveCategory("technology")).toBe(false);
      expect(isSensitiveCategory("project")).toBe(false);
    });
  });
});

describe("Memory Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createMemory", () => {
    it("creates memory with correct defaults", async () => {
      const mockCreate = vi.mocked(prisma.memoryRecord.create);
      mockCreate.mockResolvedValue({
        id: "mem-1",
        userId: "user-1",
        type: "PREFERENCE",
        scope: "GLOBAL_USER",
        content: "User prefers dark mode",
        title: null,
        summary: null,
        importance: 0.8,
        confidence: 0.9,
        embedding: null,
        projectId: null,
        conversationId: null,
        taskId: null,
        documentId: null,
        sourceType: "user_explicit",
        sourceId: "conv-1",
        provenance: JSON.stringify({ sourceType: "user_explicit", sourceId: "conv-1" }),
        tags: JSON.stringify(["ui", "preference"]),
        entities: JSON.stringify([]),
        privacyLevel: "NORMAL",
        userVisible: true,
        userConfirmed: true,
        status: "ACTIVE",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: null,
        expiresAt: null,
      });

      const memory = await memoryService.createMemory({
        userId: "user-1",
        type: "PREFERENCE",
        scope: "GLOBAL_USER",
        content: "User prefers dark mode",
        sourceType: "user_explicit",
        sourceId: "conv-1",
        tags: ["ui", "preference"],
        userConfirmed: true,
        importance: 0.8,
        confidence: 0.9,
      });

      expect(memory.id).toBe("mem-1");
      expect(memory.type).toBe("PREFERENCE");
      expect(memory.importance).toBe(0.8);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            type: "PREFERENCE",
            scope: "GLOBAL_USER",
          }),
        })
      );
    });
  });

  describe("searchMemories", () => {
    it("returns empty array when no memories", async () => {
      const mockFindMany = vi.mocked(prisma.memoryRecord.findMany);
      mockFindMany.mockResolvedValue([]);

      const results = await memoryService.searchMemories({
        userId: "user-1",
        query: "test",
      });

      expect(results).toEqual([]);
    });

    it("filters by type and scope", async () => {
      const mockFindMany = vi.mocked(prisma.memoryRecord.findMany);
      mockFindMany.mockResolvedValue([]);

      await memoryService.searchMemories({
        userId: "user-1",
        types: ["PREFERENCE"],
        scopes: ["GLOBAL_USER"],
        projectId: "proj-1",
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: { in: ["PREFERENCE"] },
            scope: { in: ["GLOBAL_USER"] },
            projectId: "proj-1",
          }),
        })
      );
    });
  });

  describe("getMemoryStats", () => {
    it("calculates stats correctly", async () => {
      const mockFindMany = vi.mocked(prisma.memoryRecord.findMany);
      mockFindMany.mockResolvedValue([
        { type: "PREFERENCE", scope: "GLOBAL_USER", importance: 0.8, confidence: 0.9, status: "ACTIVE", embedding: null },
        { type: "PROJECT", scope: "PROJECT", importance: 0.6, confidence: 0.7, status: "ACTIVE", embedding: null },
        { type: "PREFERENCE", scope: "GLOBAL_USER", importance: 0.5, confidence: 0.6, status: "ARCHIVED", embedding: null },
      ]);

      const stats = await memoryService.getMemoryStats("user-1");

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.archived).toBe(1);
      expect(stats.byType.PREFERENCE).toBe(2);
      expect(stats.byType.PROJECT).toBe(1);
      expect(stats.byScope.GLOBAL_USER).toBe(2);
      expect(stats.byScope.PROJECT).toBe(1);
    });
  });
});

describe("Memory Extractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleExplicitMemoryCommand", () => {
    it("handles remember command", async () => {
      const mockCreate = vi.mocked(prisma.memoryRecord.create);
      mockCreate.mockResolvedValue({
        id: "mem-1",
        userId: "user-1",
        type: "PREFERENCE",
        scope: "GLOBAL_USER",
        content: "I like TypeScript",
        title: null,
        summary: null,
        importance: 0.8,
        confidence: 0.9,
        embedding: null,
        projectId: null,
        conversationId: "conv-1",
        taskId: null,
        documentId: null,
        sourceType: "user_explicit",
        sourceId: "conv-1",
        provenance: JSON.stringify({ sourceType: "user_explicit", sourceId: "conv-1", userConfirmed: true }),
        tags: JSON.stringify([]),
        entities: JSON.stringify([]),
        privacyLevel: "NORMAL",
        userVisible: true,
        userConfirmed: true,
        status: "ACTIVE",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: null,
        expiresAt: null,
      });

      const result = await memoryExtractor.handleExplicitMemoryCommand(
        "user-1",
        "Remember that I like TypeScript",
        { conversationId: "conv-1" }
      );

      expect(result.saved).toBe(true);
      expect(result.message).toBe("Memory saved.");
    });

    it("handles forget command", async () => {
      const mockFindMany = vi.mocked(prisma.memoryRecord.findMany);
      mockFindMany.mockResolvedValue([
        {
          id: "mem-1",
          userId: "user-1",
          type: "PREFERENCE",
          scope: "GLOBAL_USER",
          content: "I like TypeScript",
          title: null,
          summary: null,
          importance: 0.8,
          confidence: 0.9,
          embedding: null,
          projectId: null,
          conversationId: "conv-1",
          taskId: null,
          documentId: null,
          sourceType: "user_explicit",
          sourceId: "conv-1",
          provenance: JSON.stringify({ sourceType: "user_explicit", sourceId: "conv-1" }),
          tags: JSON.stringify([]),
          entities: JSON.stringify([]),
          privacyLevel: "NORMAL",
          userVisible: true,
          userConfirmed: true,
          status: "ACTIVE",
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastAccessedAt: null,
          expiresAt: null,
        },
      ]);

      const mockUpdate = vi.mocked(prisma.memoryRecord.update);
      mockUpdate.mockResolvedValue({} as any);

      const result = await memoryExtractor.handleExplicitMemoryCommand(
        "user-1",
        "Forget that I like TypeScript",
        { conversationId: "conv-1" }
      );

      expect(result.saved).toBe(false);
      expect(result.message).toBe("Memory deleted.");
    });
  });
});

describe("Knowledge Graph Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("upsertEntity", () => {
    it("creates new entity", async () => {
      const mockFindUnique = vi.mocked(prisma.knowledgeEntity.findUnique);
      mockFindUnique.mockResolvedValue(null);

      const mockCreate = vi.mocked(prisma.knowledgeEntity.create);
      mockCreate.mockResolvedValue({
        id: "ent-1",
        userId: "user-1",
        name: "TypeScript",
        type: "Technology",
        description: "Programming language",
        properties: null,
        confidence: 0.8,
        importance: 0.4,
        sourceType: "conversation",
        sourceId: "conv-1",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: null,
      });

      const entity = await knowledgeGraphService.upsertEntity("user-1", {
        name: "TypeScript",
        type: "Technology",
        description: "Programming language",
        confidence: 0.8,
        sourceType: "conversation",
        sourceId: "conv-1",
      });

      expect(entity.id).toBe("ent-1");
      expect(entity.name).toBe("TypeScript");
    });

    it("updates existing entity", async () => {
      const mockFindUnique = vi.mocked(prisma.knowledgeEntity.findUnique);
      mockFindUnique.mockResolvedValue({
        id: "ent-1",
        userId: "user-1",
        name: "TypeScript",
        type: "Technology",
        description: "Old description",
        properties: null,
        confidence: 0.5,
        importance: 0.3,
        sourceType: "conversation",
        sourceId: "conv-1",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: null,
      });

      const mockUpdate = vi.mocked(prisma.knowledgeEntity.update);
      mockUpdate.mockResolvedValue({
        id: "ent-1",
        userId: "user-1",
        name: "TypeScript",
        type: "Technology",
        description: "New description",
        properties: null,
        confidence: 0.8,
        importance: 0.4,
        sourceType: "conversation",
        sourceId: "conv-1",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      });

      const entity = await knowledgeGraphService.upsertEntity("user-1", {
        name: "TypeScript",
        type: "Technology",
        description: "New description",
        confidence: 0.8,
        sourceType: "conversation",
        sourceId: "conv-1",
      });

      expect(entity.confidence).toBe(0.8);
      expect(entity.description).toBe("New description");
    });
  });
});
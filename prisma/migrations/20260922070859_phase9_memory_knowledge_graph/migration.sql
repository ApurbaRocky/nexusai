-- CreateTable
CREATE TABLE "MemoryRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "conversationId" TEXT,
    "taskId" TEXT,
    "documentId" TEXT,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL_USER',
    "title" TEXT,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "importance" REAL NOT NULL DEFAULT 0.5,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "provenance" TEXT,
    "embedding" TEXT,
    "tags" TEXT,
    "entities" TEXT,
    "privacyLevel" TEXT NOT NULL DEFAULT 'NORMAL',
    "userVisible" BOOLEAN NOT NULL DEFAULT true,
    "userConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastAccessedAt" DATETIME,
    "expiresAt" DATETIME,
    CONSTRAINT "MemoryRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MemoryRecord_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MemoryRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MemoryRecord_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "importance" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "tags" TEXT,
    "entities" TEXT,
    "changedBy" TEXT NOT NULL,
    "changeReason" TEXT,
    "version" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryVersion_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "MemoryRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryEmbedding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryEmbedding_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "MemoryRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryTag_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "MemoryRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemorySource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "memoryIds" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MemoryConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "conflictingMemoryId" TEXT NOT NULL,
    "conflictType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryConflict_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryConflict_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "MemoryRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryConflict_conflictingMemoryId_fkey" FOREIGN KEY ("conflictingMemoryId") REFERENCES "MemoryRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryAccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "operation" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "meta" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryAccessLog_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "MemoryRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryAccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "agentId" TEXT,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "MemoryConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryConsent_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "MemoryRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryRetentionPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetValue" TEXT,
    "maxAgeDays" INTEGER,
    "maxCount" INTEGER,
    "minImportance" REAL,
    "autoArchive" BOOLEAN NOT NULL DEFAULT false,
    "autoDelete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryRetentionPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryScope" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryScope_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MemoryScope" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeEntity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "properties" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "importance" REAL NOT NULL DEFAULT 0.5,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastAccessedAt" DATETIME,
    CONSTRAINT "KnowledgeEntity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeRelationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "properties" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeRelationship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeRelationship_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "KnowledgeEntity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeRelationship_targetEntityId_fkey" FOREIGN KEY ("targetEntityId") REFERENCES "KnowledgeEntity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "entityId" TEXT,
    "relationshipId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "excerpt" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeEvidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeEvidence_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "KnowledgeEntity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeEvidence_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "KnowledgeRelationship" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryAgentPermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "MemoryAgentPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryExport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryExport_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "MemoryRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_MemoryEntities" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_MemoryEntities_A_fkey" FOREIGN KEY ("A") REFERENCES "KnowledgeEntity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_MemoryEntities_B_fkey" FOREIGN KEY ("B") REFERENCES "MemoryRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_status_idx" ON "MemoryRecord"("userId", "status");

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_type_idx" ON "MemoryRecord"("userId", "type");

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_scope_idx" ON "MemoryRecord"("userId", "scope");

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_projectId_idx" ON "MemoryRecord"("userId", "projectId");

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_conversationId_idx" ON "MemoryRecord"("userId", "conversationId");

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_taskId_idx" ON "MemoryRecord"("userId", "taskId");

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_createdAt_idx" ON "MemoryRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_importance_idx" ON "MemoryRecord"("userId", "importance");

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_expiresAt_idx" ON "MemoryRecord"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "MemoryRecord_sourceType_sourceId_idx" ON "MemoryRecord"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "MemoryVersion_memoryId_version_idx" ON "MemoryVersion"("memoryId", "version");

-- CreateIndex
CREATE INDEX "MemoryVersion_userId_idx" ON "MemoryVersion"("userId");

-- CreateIndex
CREATE INDEX "MemoryEmbedding_memoryId_idx" ON "MemoryEmbedding"("memoryId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryEmbedding_memoryId_key" ON "MemoryEmbedding"("memoryId");

-- CreateIndex
CREATE INDEX "MemoryTag_tag_idx" ON "MemoryTag"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryTag_memoryId_tag_key" ON "MemoryTag"("memoryId", "tag");

-- CreateIndex
CREATE INDEX "MemorySource_sourceType_sourceId_idx" ON "MemorySource"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "MemoryConflict_userId_resolution_idx" ON "MemoryConflict"("userId", "resolution");

-- CreateIndex
CREATE INDEX "MemoryConflict_memoryId_idx" ON "MemoryConflict"("memoryId");

-- CreateIndex
CREATE INDEX "MemoryConflict_conflictingMemoryId_idx" ON "MemoryConflict"("conflictingMemoryId");

-- CreateIndex
CREATE INDEX "MemoryAccessLog_userId_createdAt_idx" ON "MemoryAccessLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryAccessLog_memoryId_createdAt_idx" ON "MemoryAccessLog"("memoryId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryAccessLog_agentId_createdAt_idx" ON "MemoryAccessLog"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryConsent_userId_granted_idx" ON "MemoryConsent"("userId", "granted");

-- CreateIndex
CREATE INDEX "MemoryConsent_memoryId_idx" ON "MemoryConsent"("memoryId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryConsent_userId_memoryId_scope_agentId_key" ON "MemoryConsent"("userId", "memoryId", "scope", "agentId");

-- CreateIndex
CREATE INDEX "MemoryRetentionPolicy_userId_idx" ON "MemoryRetentionPolicy"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryRetentionPolicy_userId_type_targetValue_key" ON "MemoryRetentionPolicy"("userId", "type", "targetValue");

-- CreateIndex
CREATE INDEX "MemoryScope_userId_idx" ON "MemoryScope"("userId");

-- CreateIndex
CREATE INDEX "MemoryScope_parentId_idx" ON "MemoryScope"("parentId");

-- CreateIndex
CREATE INDEX "KnowledgeEntity_userId_type_idx" ON "KnowledgeEntity"("userId", "type");

-- CreateIndex
CREATE INDEX "KnowledgeEntity_userId_name_idx" ON "KnowledgeEntity"("userId", "name");

-- CreateIndex
CREATE INDEX "KnowledgeEntity_userId_status_idx" ON "KnowledgeEntity"("userId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeEntity_sourceType_sourceId_idx" ON "KnowledgeEntity"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEntity_userId_type_name_key" ON "KnowledgeEntity"("userId", "type", "name");

-- CreateIndex
CREATE INDEX "KnowledgeRelationship_userId_idx" ON "KnowledgeRelationship"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeRelationship_sourceEntityId_idx" ON "KnowledgeRelationship"("sourceEntityId");

-- CreateIndex
CREATE INDEX "KnowledgeRelationship_targetEntityId_idx" ON "KnowledgeRelationship"("targetEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRelationship_sourceEntityId_targetEntityId_type_key" ON "KnowledgeRelationship"("sourceEntityId", "targetEntityId", "type");

-- CreateIndex
CREATE INDEX "KnowledgeEvidence_userId_idx" ON "KnowledgeEvidence"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeEvidence_entityId_idx" ON "KnowledgeEvidence"("entityId");

-- CreateIndex
CREATE INDEX "KnowledgeEvidence_relationshipId_idx" ON "KnowledgeEvidence"("relationshipId");

-- CreateIndex
CREATE INDEX "KnowledgeEvidence_sourceType_sourceId_idx" ON "KnowledgeEvidence"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "MemoryAgentPermission_userId_agentId_idx" ON "MemoryAgentPermission"("userId", "agentId");

-- CreateIndex
CREATE INDEX "MemoryAgentPermission_agentId_scope_idx" ON "MemoryAgentPermission"("agentId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryAgentPermission_userId_agentId_permission_scope_scopeId_key" ON "MemoryAgentPermission"("userId", "agentId", "permission", "scope", "scopeId");

-- CreateIndex
CREATE INDEX "MemoryExport_userId_createdAt_idx" ON "MemoryExport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryExport_memoryId_idx" ON "MemoryExport"("memoryId");

-- CreateIndex
CREATE UNIQUE INDEX "_MemoryEntities_AB_unique" ON "_MemoryEntities"("A", "B");

-- CreateIndex
CREATE INDEX "_MemoryEntities_B_index" ON "_MemoryEntities"("B");

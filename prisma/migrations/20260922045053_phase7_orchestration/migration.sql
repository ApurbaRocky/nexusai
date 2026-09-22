-- CreateTable
CREATE TABLE "OrchestrationTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "conversationId" TEXT,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "risk" TEXT NOT NULL DEFAULT 'read_only',
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "plan" TEXT,
    "context" TEXT,
    "input" TEXT NOT NULL DEFAULT '',
    "budget" TEXT,
    "budgetUsage" TEXT,
    "result" TEXT,
    "error" TEXT,
    "checkpointRef" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrchestrationTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrchestrationTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrchestrationNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" TEXT NOT NULL,
    "agent" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "order" INTEGER NOT NULL DEFAULT 0,
    "dependencies" TEXT,
    "inputs" TEXT,
    "outputs" TEXT,
    "artifactRefs" TEXT,
    "error" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "timeoutMs" INTEGER NOT NULL DEFAULT 300000,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrchestrationNode_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'data',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "OrchestrationNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "OrchestrationNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "nodeId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskEvent_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrchestrationNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "nodeId" TEXT,
    "senderAgent" TEXT NOT NULL,
    "receiverAgent" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "references" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "nodeId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL DEFAULT '',
    "requestedBy" TEXT NOT NULL,
    "askedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskApproval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskApproval_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrchestrationNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "nodeId" TEXT,
    "creatorAgent" TEXT NOT NULL DEFAULT 'general',
    "artifactType" TEXT NOT NULL DEFAULT 'note',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT,
    "refId" TEXT,
    "provenance" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskArtifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskCheckpoint_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskMemory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "nodeId" TEXT,
    "question" TEXT NOT NULL,
    "options" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "answer" TEXT,
    "askedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskQuestion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskQuestion_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrchestrationNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "nodeId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'agent',
    "agent" TEXT,
    "tool" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "ok" BOOLEAN,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "costUsd" REAL,
    "costEstimated" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "error" TEXT,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskRun_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrchestrationNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OrchestrationTask_userId_status_idx" ON "OrchestrationTask"("userId", "status");

-- CreateIndex
CREATE INDEX "OrchestrationTask_userId_updatedAt_idx" ON "OrchestrationTask"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "OrchestrationTask_projectId_idx" ON "OrchestrationTask"("projectId");

-- CreateIndex
CREATE INDEX "OrchestrationNode_taskId_status_idx" ON "OrchestrationNode"("taskId", "status");

-- CreateIndex
CREATE INDEX "OrchestrationNode_parentId_idx" ON "OrchestrationNode"("parentId");

-- CreateIndex
CREATE INDEX "TaskDependency_taskId_idx" ON "TaskDependency"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_fromNodeId_toNodeId_key" ON "TaskDependency"("fromNodeId", "toNodeId");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskEvent_nodeId_idx" ON "TaskEvent"("nodeId");

-- CreateIndex
CREATE INDEX "AgentMessage_taskId_createdAt_idx" ON "AgentMessage"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskApproval_taskId_status_idx" ON "TaskApproval"("taskId", "status");

-- CreateIndex
CREATE INDEX "TaskArtifact_taskId_artifactType_idx" ON "TaskArtifact"("taskId", "artifactType");

-- CreateIndex
CREATE INDEX "TaskCheckpoint_taskId_idx" ON "TaskCheckpoint"("taskId");

-- CreateIndex
CREATE INDEX "TaskMemory_taskId_idx" ON "TaskMemory"("taskId");

-- CreateIndex
CREATE INDEX "TaskQuestion_taskId_status_idx" ON "TaskQuestion"("taskId", "status");

-- CreateIndex
CREATE INDEX "TaskRun_taskId_kind_idx" ON "TaskRun"("taskId", "kind");

-- CreateIndex
CREATE INDEX "TaskRun_nodeId_idx" ON "TaskRun"("nodeId");

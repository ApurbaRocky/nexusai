-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "nodeId" TEXT,
    "agentId" TEXT NOT NULL,
    "toolId" TEXT,
    "actionType" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "exactAction" TEXT NOT NULL,
    "approvalHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "rejectedAt" DATETIME,
    "decidedBy" TEXT,
    CONSTRAINT "ApprovalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApprovalRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestrationTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ApprovalRequest_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrchestrationNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApprovalAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "approvalId" TEXT,
    "actionType" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "meta" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ApprovalRequest_userId_status_idx" ON "ApprovalRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_taskId_status_idx" ON "ApprovalRequest"("taskId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_agentId_status_idx" ON "ApprovalRequest"("agentId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_expiresAt_idx" ON "ApprovalRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "ApprovalAudit_userId_createdAt_idx" ON "ApprovalAudit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalAudit_approvalId_idx" ON "ApprovalAudit"("approvalId");

-- CreateIndex
CREATE INDEX "ApprovalAudit_event_createdAt_idx" ON "ApprovalAudit"("event", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalAudit_actionType_createdAt_idx" ON "ApprovalAudit"("actionType", "createdAt");

-- CreateTable
CREATE TABLE "CodingWorkspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sourceType" TEXT NOT NULL DEFAULT 'upload',
    "rootPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "indexError" TEXT,
    "language" TEXT,
    "framework" TEXT,
    "entryPoints" TEXT,
    "stats" TEXT,
    "ignorePatterns" TEXT,
    "permissionLevel" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "lastIndexedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodingWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodebaseFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'unknown',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "hash" TEXT NOT NULL,
    "lineCount" INTEGER,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "isConfig" BOOLEAN NOT NULL DEFAULT false,
    "isDoc" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT,
    "symbolIndex" TEXT,
    "imports" TEXT,
    "exports" TEXT,
    "routes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodebaseFile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodeSymbol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER,
    "signature" TEXT,
    "language" TEXT NOT NULL DEFAULT 'unknown',
    "access" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeSymbol_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodeSymbol_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CodebaseFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodeDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL DEFAULT 'import',
    "line" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeDependency_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodeDependency_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CodebaseFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodingTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'understand',
    "status" TEXT NOT NULL DEFAULT 'created',
    "plan" TEXT,
    "config" TEXT,
    "result" TEXT,
    "error" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodingTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodingTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodingPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "filesAffected" TEXT,
    "risks" TEXT,
    "cost" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodingPlan_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CodingTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodingChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "newPath" TEXT,
    "baseHash" TEXT,
    "targetHash" TEXT,
    "oldContent" TEXT,
    "newContent" TEXT,
    "diffPreview" TEXT,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME,
    CONSTRAINT "CodingChange_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CodingTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodingChange_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodingPatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "changeId" TEXT NOT NULL,
    "taskId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ops" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "appliedAt" DATETIME,
    "rollbackData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodingPatch_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "CodingChange" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodingPatch_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CodingTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodingPatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodingTestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "exitCode" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "output" TEXT,
    "durationMs" INTEGER,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodingTestRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodingTestRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CodingTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodingCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "args" TEXT,
    "cwd" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "permission" TEXT NOT NULL DEFAULT 'granted',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "exitCode" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "durationMs" INTEGER,
    "blockedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "CodingCommand_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodingCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fileHashes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodingCheckpoint_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CodingTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodingCheckpoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodingSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "reason" TEXT NOT NULL,
    "files" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodingSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodingSnapshot_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CodingTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GitOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "params" TEXT,
    "output" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "writeAccess" BOOLEAN NOT NULL DEFAULT false,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GitOperation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "CodingWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CodingWorkspace_userId_idx" ON "CodingWorkspace"("userId");

-- CreateIndex
CREATE INDEX "CodebaseFile_workspaceId_language_idx" ON "CodebaseFile"("workspaceId", "language");

-- CreateIndex
CREATE INDEX "CodebaseFile_workspaceId_isTest_idx" ON "CodebaseFile"("workspaceId", "isTest");

-- CreateIndex
CREATE UNIQUE INDEX "CodebaseFile_workspaceId_path_key" ON "CodebaseFile"("workspaceId", "path");

-- CreateIndex
CREATE INDEX "CodeSymbol_workspaceId_name_idx" ON "CodeSymbol"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "CodeSymbol_workspaceId_kind_idx" ON "CodeSymbol"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "CodeSymbol_fileId_idx" ON "CodeSymbol"("fileId");

-- CreateIndex
CREATE INDEX "CodeDependency_workspaceId_target_idx" ON "CodeDependency"("workspaceId", "target");

-- CreateIndex
CREATE INDEX "CodeDependency_fileId_idx" ON "CodeDependency"("fileId");

-- CreateIndex
CREATE INDEX "CodingTask_workspaceId_idx" ON "CodingTask"("workspaceId");

-- CreateIndex
CREATE INDEX "CodingTask_userId_idx" ON "CodingTask"("userId");

-- CreateIndex
CREATE INDEX "CodingPlan_taskId_idx" ON "CodingPlan"("taskId");

-- CreateIndex
CREATE INDEX "CodingPlan_workspaceId_idx" ON "CodingPlan"("workspaceId");

-- CreateIndex
CREATE INDEX "CodingChange_workspaceId_idx" ON "CodingChange"("workspaceId");

-- CreateIndex
CREATE INDEX "CodingChange_taskId_idx" ON "CodingChange"("taskId");

-- CreateIndex
CREATE INDEX "CodingPatch_changeId_idx" ON "CodingPatch"("changeId");

-- CreateIndex
CREATE INDEX "CodingPatch_workspaceId_idx" ON "CodingPatch"("workspaceId");

-- CreateIndex
CREATE INDEX "CodingTestRun_workspaceId_idx" ON "CodingTestRun"("workspaceId");

-- CreateIndex
CREATE INDEX "CodingTestRun_taskId_idx" ON "CodingTestRun"("taskId");

-- CreateIndex
CREATE INDEX "CodingCommand_workspaceId_idx" ON "CodingCommand"("workspaceId");

-- CreateIndex
CREATE INDEX "CodingCheckpoint_taskId_idx" ON "CodingCheckpoint"("taskId");

-- CreateIndex
CREATE INDEX "CodingCheckpoint_workspaceId_idx" ON "CodingCheckpoint"("workspaceId");

-- CreateIndex
CREATE INDEX "CodingSnapshot_workspaceId_idx" ON "CodingSnapshot"("workspaceId");

-- CreateIndex
CREATE INDEX "GitOperation_workspaceId_idx" ON "GitOperation"("workspaceId");

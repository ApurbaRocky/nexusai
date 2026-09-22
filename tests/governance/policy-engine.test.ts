import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateGovernance, verifyAndExecuteApproval, emergencyStop, isProtectedAction, getActionCategory } from "@/lib/governance/policy-engine";
import { requestApproval, checkApprovalStatus, validateAndMarkExecuted, cancelPendingApprovalsForTask } from "@/lib/governance/approval-service";
import { prisma } from "@/database/client";

vi.mock("@/database/client", () => ({
  prisma: {
    approvalRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    approvalAudit: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/security/audit", () => ({
  audit: vi.fn(),
}));

vi.mock("@/utils/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Governance Policy Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isProtectedAction", () => {
    it("returns true for DELETE actions", () => {
      expect(isProtectedAction("DELETE")).toBe(true);
      expect(isProtectedAction("delete")).toBe(true);
    });

    it("returns true for EXECUTE actions", () => {
      expect(isProtectedAction("EXECUTE")).toBe(true);
      expect(isProtectedAction("RUN_COMMAND")).toBe(true);
    });

    it("returns true for MODIFY actions", () => {
      expect(isProtectedAction("WRITE")).toBe(true);
      expect(isProtectedAction("EDIT")).toBe(true);
      expect(isProtectedAction("OVERWRITE")).toBe(true);
    });

    it("returns true for SEND actions", () => {
      expect(isProtectedAction("SEND")).toBe(true);
      expect(isProtectedAction("PUBLISH")).toBe(true);
      expect(isProtectedAction("DEPLOY")).toBe(true);
      expect(isProtectedAction("PUSH")).toBe(true);
      expect(isProtectedAction("COMMIT")).toBe(true);
    });

    it("returns true for FINANCIAL actions", () => {
      expect(isProtectedAction("PURCHASE")).toBe(true);
      expect(isProtectedAction("PAYMENT")).toBe(true);
    });

    it("returns true for SECURITY actions", () => {
      expect(isProtectedAction("PASSWORD_CHANGE")).toBe(true);
      expect(isProtectedAction("PERMISSION_CHANGE")).toBe(true);
    });

    it("returns false for read-only actions", () => {
      expect(isProtectedAction("READ")).toBe(false);
      expect(isProtectedAction("LIST")).toBe(false);
      expect(isProtectedAction("SEARCH")).toBe(false);
    });
  });

  describe("getActionCategory", () => {
    it("returns HIGH_RISK for DELETE", () => {
      expect(getActionCategory("DELETE")).toBe("HIGH_RISK");
      expect(getActionCategory("DROP")).toBe("HIGH_RISK");
      expect(getActionCategory("TRUNCATE")).toBe("HIGH_RISK");
    });

    it("returns COMMAND_EXECUTION for command actions", () => {
      expect(getActionCategory("EXECUTE")).toBe("COMMAND_EXECUTION");
      expect(getActionCategory("RUN_COMMAND")).toBe("COMMAND_EXECUTION");
      expect(getActionCategory("SHELL")).toBe("COMMAND_EXECUTION");
    });

    it("returns WRITE for file modifications", () => {
      expect(getActionCategory("WRITE")).toBe("WRITE");
      expect(getActionCategory("EDIT")).toBe("WRITE");
      expect(getActionCategory("OVERWRITE")).toBe("WRITE");
    });

    it("returns EXTERNAL_ACTION for send actions", () => {
      expect(getActionCategory("SEND")).toBe("EXTERNAL_ACTION");
      expect(getActionCategory("PUBLISH")).toBe("EXTERNAL_ACTION");
      expect(getActionCategory("DEPLOY")).toBe("EXTERNAL_ACTION");
    });

    it("returns HIGH_RISK for financial actions", () => {
      expect(getActionCategory("PURCHASE")).toBe("HIGH_RISK");
      expect(getActionCategory("PAYMENT")).toBe("HIGH_RISK");
    });

    it("returns LOW_RISK for unknown actions", () => {
      expect(getActionCategory("UNKNOWN_ACTION")).toBe("LOW_RISK");
    });
  });

  describe("evaluateGovernance", () => {
    it("allows read-only actions without approval", async () => {
      const result = await evaluateGovernance({
        userId: "user-1",
        agentId: "coding",
        toolId: "coding.read_file",
        actionType: "READ_FILE",
        target: "/project/test.ts",
        description: "Read a file",
        riskLevel: "READ_ONLY",
        exactAction: { actionType: "READ_FILE", target: "/project/test.ts" },
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("requires approval for DELETE actions", async () => {
      const mockCreate = vi.mocked(prisma.approvalRequest.create);
      mockCreate.mockResolvedValue({
        id: "approval-1",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash123",
      } as never);

      const result = await evaluateGovernance({
        userId: "user-1",
        taskId: "task-1",
        agentId: "coding",
        toolId: "coding.delete_file",
        actionType: "DELETE_FILE",
        target: "/project/test.ts",
        description: "Delete a file",
        riskLevel: "HIGH_RISK",
        exactAction: { actionType: "DELETE_FILE", target: "/project/test.ts", filePath: "/project/test.ts" },
      });

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.approvalId).toBe("approval-1");
      expect(result.ruleIds).toContain("RULE-USER-CONTROL-001");
      expect(result.ruleIds).toContain("RULE-USER-CONTROL-002");
    });

    it("requires approval for COMMAND_EXECUTION", async () => {
      const mockCreate = vi.mocked(prisma.approvalRequest.create);
      mockCreate.mockResolvedValue({
        id: "approval-2",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash456",
      } as never);

      const result = await evaluateGovernance({
        userId: "user-1",
        taskId: "task-1",
        agentId: "coding",
        toolId: "shell",
        actionType: "RUN_COMMAND",
        target: "npm run build",
        description: "Run build command",
        riskLevel: "COMMAND_EXECUTION",
        exactAction: { actionType: "RUN_COMMAND", target: "npm run build", command: "npm run build", workingDirectory: "/project" },
      });

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.ruleIds).toContain("RULE-USER-CONTROL-003");
    });

    it("requires approval for file modifications", async () => {
      const mockCreate = vi.mocked(prisma.approvalRequest.create);
      mockCreate.mockResolvedValue({
        id: "approval-3",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash789",
      } as never);

      const result = await evaluateGovernance({
        userId: "user-1",
        taskId: "task-1",
        agentId: "coding",
        toolId: "coding.apply_patch",
        actionType: "EDIT_FILE",
        target: "/project/test.ts",
        description: "Edit a file",
        riskLevel: "WRITE",
        exactAction: { actionType: "EDIT_FILE", target: "/project/test.ts", filePath: "/project/test.ts", newContent: "new content" },
      });

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.ruleIds).toContain("RULE-USER-CONTROL-004");
    });
  });

  describe("emergencyStop", () => {
    it("cancels all pending approvals for user", async () => {
      const mockUpdateMany = vi.mocked(prisma.approvalRequest.updateMany);
      mockUpdateMany.mockResolvedValue({ count: 5 });

      const mockAuditCreate = vi.mocked(prisma.auditLog.create);
      mockAuditCreate.mockResolvedValue({} as any);

      await emergencyStop("user-1");

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", status: "PENDING" },
        data: { status: "CANCELLED" },
      });
    });

    it("cancels pending approvals for specific task when taskId provided", async () => {
      const mockUpdateMany = vi.mocked(prisma.approvalRequest.updateMany);
      mockUpdateMany.mockResolvedValue({ count: 2 });

      const mockAuditCreate = vi.mocked(prisma.auditLog.create);
      mockAuditCreate.mockResolvedValue({} as any);

      await emergencyStop("user-1", "task-1");

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", taskId: "task-1", status: "PENDING" },
        data: { status: "CANCELLED" },
      });
    });
  });
});
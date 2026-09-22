import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  requestApproval,
  checkApprovalStatus,
  validateAndMarkExecuted,
  markActionExecuted,
  markActionBlocked,
  cancelPendingApprovalsForTask,
  expireOldApprovals,
} from "@/lib/governance/approval-service";
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
  },
}));

vi.mock("@/security/audit", () => ({
  audit: vi.fn(),
}));

vi.mock("@/utils/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Approval Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("requestApproval", () => {
    it("creates approval request with correct fields", async () => {
      const mockCreate = vi.mocked(prisma.approvalRequest.create);
      mockCreate.mockResolvedValue({
        id: "approval-1",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash123",
        userId: "user-1",
        taskId: "task-1",
        agentId: "coding",
        actionType: "DELETE_FILE",
        target: "/project/test.ts",
        description: "Delete test file",
        riskLevel: "HIGH_RISK",
        exactAction: JSON.stringify({ actionType: "DELETE_FILE", target: "/project/test.ts" }),
      } as never);

      const result = await requestApproval({
        userId: "user-1",
        taskId: "task-1",
        agentId: "coding",
        toolId: "coding.delete_file",
        actionType: "DELETE_FILE",
        target: "/project/test.ts",
        description: "Delete test file",
        riskLevel: "HIGH_RISK",
        exactAction: { actionType: "DELETE_FILE", target: "/project/test.ts", filePath: "/project/test.ts" },
      });

      expect(result.approvalId).toBe("approval-1");
      expect(result.status).toBe("PENDING");
      expect(result.approvalHash).toBe("hash123");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            taskId: "task-1",
            agentId: "coding",
            toolId: "coding.delete_file",
            actionType: "DELETE_FILE",
            target: "/project/test.ts",
            status: "PENDING",
          }),
        }),
      );
    });

    it("creates audit log entry", async () => {
      const mockCreate = vi.mocked(prisma.approvalRequest.create);
      mockCreate.mockResolvedValue({
        id: "approval-1",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash123",
      } as never);

      const mockAuditCreate = vi.mocked(prisma.approvalAudit.create);
      mockAuditCreate.mockResolvedValue({} as any);

      await requestApproval({
        userId: "user-1",
        agentId: "coding",
        actionType: "DELETE_FILE",
        target: "/project/test.ts",
        description: "Delete test file",
        riskLevel: "HIGH_RISK",
        exactAction: { actionType: "DELETE_FILE", target: "/project/test.ts" },
      });

      expect(mockAuditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            approvalId: "approval-1",
            actionType: "DELETE_FILE",
            target: "/project/test.ts",
            event: "ACTION_REQUESTED",
            status: "PENDING",
          }),
        }),
      );
    });
  });

  describe("checkApprovalStatus", () => {
    it("returns approval status when found", async () => {
      const mockFindUnique = vi.mocked(prisma.approvalRequest.findUnique);
      mockFindUnique.mockResolvedValue({
        id: "approval-1",
        userId: "user-1",
        status: "APPROVED",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash123",
      } as any);

      const result = await checkApprovalStatus("approval-1", "user-1");

      expect(result).not.toBeNull();
      expect(result?.approvalId).toBe("approval-1");
      expect(result?.status).toBe("APPROVED");
    });

    it("returns null when approval not found", async () => {
      const mockFindUnique = vi.mocked(prisma.approvalRequest.findUnique);
      mockFindUnique.mockResolvedValue(null);

      const result = await checkApprovalStatus("nonexistent", "user-1");

      expect(result).toBeNull();
    });

    it("returns null when approval belongs to different user", async () => {
      const mockFindUnique = vi.mocked(prisma.approvalRequest.findUnique);
      mockFindUnique.mockResolvedValue({
        id: "approval-1",
        userId: "user-2",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash123",
      } as any);

      const result = await checkApprovalStatus("approval-1", "user-1");

      expect(result).toBeNull();
    });

    it("marks expired approvals as EXPIRED", async () => {
      const mockFindUnique = vi.mocked(prisma.approvalRequest.findUnique);
      mockFindUnique.mockResolvedValue({
        id: "approval-1",
        userId: "user-1",
        status: "PENDING",
        expiresAt: new Date(Date.now() - 1000), // Expired
        approvalHash: "hash123",
        actionType: "DELETE_FILE",
        target: "/project/test.ts",
        riskLevel: "HIGH_RISK",
      } as any);

      const mockUpdate = vi.mocked(prisma.approvalRequest.update);
      mockUpdate.mockResolvedValue({} as any);

      const mockAuditCreate = vi.mocked(prisma.approvalAudit.create);
      mockAuditCreate.mockResolvedValue({} as any);

      const result = await checkApprovalStatus("approval-1", "user-1");

      expect(result?.status).toBe("EXPIRED");
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "approval-1" },
        data: { status: "EXPIRED" },
      });
    });
  });

  describe("validateAndMarkExecuted", () => {
    it("returns ok for valid approval and matching action", async () => {
      const mockFindUnique = vi.mocked(prisma.approvalRequest.findUnique);
      mockFindUnique.mockResolvedValue({
        id: "approval-1",
        userId: "user-1",
        status: "APPROVED",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash123",
        actionType: "DELETE_FILE",
        target: "/project/test.ts",
        riskLevel: "HIGH_RISK",
        taskId: "task-1",
        nodeId: null,
      } as any);

      // The hash needs to match - we'll mock the verifyApprovalHash to return true
      const hashModule = await import("@/lib/governance/approval-hash");
      vi.spyOn(hashModule, "verifyApprovalHash").mockReturnValue(true);

      const result = await validateAndMarkExecuted(
        "approval-1",
        "user-1",
        { actionType: "DELETE_FILE", target: "/project/test.ts", filePath: "/project/test.ts" }
      );

      expect(result.ok).toBe(true);
    });

    it("rejects when approval not found", async () => {
      const mockFindUnique = vi.mocked(prisma.approvalRequest.findUnique);
      mockFindUnique.mockResolvedValue(null);

      const result = await validateAndMarkExecuted(
        "approval-1",
        "user-1",
        { actionType: "DELETE_FILE", target: "/project/test.ts" }
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Approval not found");
    });

    it("rejects when approval belongs to different user", async () => {
      const mockFindUnique = vi.mocked(prisma.approvalRequest.findUnique);
      mockFindUnique.mockResolvedValue({
        id: "approval-1",
        userId: "user-2",
        status: "APPROVED",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash123",
      } as any);

      const result = await validateAndMarkExecuted(
        "approval-1",
        "user-1",
        { actionType: "DELETE_FILE", target: "/project/test.ts" }
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Unauthorized");
    });

    it("rejects when approval not approved", async () => {
      const mockFindUnique = vi.mocked(prisma.approvalRequest.findUnique);
      mockFindUnique.mockResolvedValue({
        id: "approval-1",
        userId: "user-1",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash123",
      } as any);

      const result = await validateAndMarkExecuted(
        "approval-1",
        "user-1",
        { actionType: "DELETE_FILE", target: "/project/test.ts" }
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not approved");
    });

    it("rejects when approval expired", async () => {
      const mockFindUnique = vi.mocked(prisma.approvalRequest.findUnique);
      mockFindUnique.mockResolvedValue({
        id: "approval-1",
        userId: "user-1",
        status: "PENDING",
        expiresAt: new Date(Date.now() - 1000),
        approvalHash: "hash123",
      } as any);

      const mockUpdate = vi.mocked(prisma.approvalRequest.update);
      mockUpdate.mockResolvedValue({} as any);

      const result = await validateAndMarkExecuted(
        "approval-1",
        "user-1",
        { actionType: "DELETE_FILE", target: "/project/test.ts" }
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Approval expired");
    });

    it("rejects when action hash doesn't match", async () => {
      const mockFindUnique = vi.mocked(prisma.approvalRequest.findUnique);
      mockFindUnique.mockResolvedValue({
        id: "approval-1",
        userId: "user-1",
        status: "APPROVED",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "hash123",
        actionType: "DELETE_FILE",
        target: "/project/test.ts",
        riskLevel: "HIGH_RISK",
      } as any);

      const hashModule = await import("@/lib/governance/approval-hash");
      vi.spyOn(hashModule, "verifyApprovalHash").mockReturnValue(false);

      const mockAuditCreate = vi.mocked(prisma.approvalAudit.create);
      mockAuditCreate.mockResolvedValue({} as any);

      const result = await validateAndMarkExecuted(
        "approval-1",
        "user-1",
        { actionType: "DELETE_FILE", target: "/project/other.ts" } // Different target!
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Action does not match approved action (hash mismatch)");
    });
  });

  describe("cancelPendingApprovalsForTask", () => {
    it("cancels all pending approvals for a task", async () => {
      const mockUpdateMany = vi.mocked(prisma.approvalRequest.updateMany);
      mockUpdateMany.mockResolvedValue({ count: 3 });

      await cancelPendingApprovalsForTask("task-1", "user-1");

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { taskId: "task-1", userId: "user-1", status: "PENDING" },
        data: { status: "CANCELLED" },
      });
    });
  });

  describe("expireOldApprovals", () => {
    it("expires old pending approvals", async () => {
      const mockUpdateMany = vi.mocked(prisma.approvalRequest.updateMany);
      mockUpdateMany.mockResolvedValue({ count: 5 });

      const count = await expireOldApprovals();

      expect(count).toBe(5);
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { status: "PENDING", expiresAt: { lt: expect.any(Date) } },
        data: { status: "EXPIRED" },
      });
    });
  });
});
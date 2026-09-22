import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as createApproval, GET as listApprovals } from "@/app/api/governance/approval-requests/route";
import { prisma } from "@/database/client";
import { NextRequest } from "next/server";

vi.mock("@/database/client", () => ({
  prisma: {
    approvalRequest: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    approvalAudit: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/auth/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/security/audit", () => ({
  audit: vi.fn(),
}));

vi.mock("@/utils/log", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/governance/approval-hash", () => ({
  createApprovalHash: vi.fn(() => "mock-hash-123"),
}));

describe("Approval API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/governance/approval-requests", () => {
    it("returns 401 when unauthenticated", async () => {
      const { auth } = await import("@/auth/auth");
      (vi.mocked(auth) as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/governance/approval-requests", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await createApproval(req);
      expect(response.status).toBe(401);
    });

    it("returns 400 when required fields missing", async () => {
      const { auth } = await import("@/auth/auth");
      (vi.mocked(auth) as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({ user: { id: "user-1" } });

      const req = new NextRequest("http://localhost/api/governance/approval-requests", {
        method: "POST",
        body: JSON.stringify({ actionType: "DELETE" }),
      });

      const response = await createApproval(req);
      expect(response.status).toBe(400);
    });

    it("creates approval request when valid", async () => {
      const { auth } = await import("@/auth/auth");
      (vi.mocked(auth) as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({ user: { id: "user-1" } });

      const mockCreate = vi.mocked(prisma.approvalRequest.create);
      mockCreate.mockResolvedValue({
        id: "approval-1",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 300000),
        approvalHash: "mock-hash-123",
      } as any);

      const req = new NextRequest("http://localhost/api/governance/approval-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "coding",
          actionType: "DELETE_FILE",
          target: "/project/test.ts",
          description: "Delete test file",
          riskLevel: "HIGH_RISK",
          exactAction: { actionType: "DELETE_FILE", target: "/project/test.ts", filePath: "/project/test.ts" },
        }),
      });

      const response = await createApproval(req);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.id).toBe("approval-1");
      expect(data.status).toBe("PENDING");
      expect(data.approvalHash).toBe("mock-hash-123");
    });
  });

  describe("GET /api/governance/approval-requests", () => {
    it("returns 401 when unauthenticated", async () => {
      const { auth } = await import("@/auth/auth");
      (vi.mocked(auth) as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/governance/approval-requests");

      const response = await listApprovals(req);
      expect(response.status).toBe(401);
    });

    it("returns user's approvals", async () => {
      const { auth } = await import("@/auth/auth");
      (vi.mocked(auth) as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({ user: { id: "user-1" } });

      const mockFindMany = vi.mocked(prisma.approvalRequest.findMany);
      mockFindMany.mockResolvedValue([
        {
          id: "approval-1",
          userId: "user-1",
          status: "PENDING",
          actionType: "DELETE_FILE",
          target: "/project/test.ts",
          createdAt: new Date(),
        },
      ] as any);

      const req = new NextRequest("http://localhost/api/governance/approval-requests");

      const response = await listApprovals(req);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe("approval-1");
    });

    it("filters by status when provided", async () => {
      const { auth } = await import("@/auth/auth");
      (vi.mocked(auth) as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({ user: { id: "user-1" } });

      const mockFindMany = vi.mocked(prisma.approvalRequest.findMany);
      mockFindMany.mockResolvedValue([]);

      const req = new NextRequest("http://localhost/api/governance/approval-requests?status=APPROVED");

      await listApprovals(req);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "APPROVED" }),
        })
      );
    });

    it("filters by taskId when provided", async () => {
      const { auth } = await import("@/auth/auth");
      (vi.mocked(auth) as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({ user: { id: "user-1" } });

      const mockFindMany = vi.mocked(prisma.approvalRequest.findMany);
      mockFindMany.mockResolvedValue([]);

      const req = new NextRequest("http://localhost/api/governance/approval-requests?taskId=task-1");

      await listApprovals(req);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ taskId: "task-1" }),
        })
      );
    });
  });
});
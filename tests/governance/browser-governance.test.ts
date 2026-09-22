import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserGovernanceService } from "@/agents/browser/service/governance";
import { evaluateGovernance, verifyAndExecuteApproval } from "@/lib/governance/policy-engine";
import { prisma } from "@/database/client";

vi.mock("@/lib/governance/policy-engine", () => ({
  evaluateGovernance: vi.fn(),
  verifyAndExecuteApproval: vi.fn(),
  createBrowserAction: vi.fn((actionType: string, target: string, options: Record<string, unknown> = {}) => ({ actionType, target, ...options })),
  emergencyStop: vi.fn(),
  getActionCategory: vi.fn(),
  isProtectedAction: vi.fn(),
}));

vi.mock("@/database/client", () => ({
  prisma: {
    approvalAudit: { create: vi.fn() },
  },
}));

vi.mock("@/security/audit", () => ({
  audit: vi.fn(),
}));

vi.mock("@/utils/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

describe("Browser Governance Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("requestAction", () => {
    it("allows read-only actions without approval", async () => {
      const result = await BrowserGovernanceService.requestAction({
        sessionId: "session-1",
        userId: "user-1",
        agentId: "browser",
        actionType: "NAVIGATE",
        targetUrl: "https://example.com",
        description: "Navigate to page",
      });

      expect(result.approved).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("allows SCROLL without approval", async () => {
      const result = await BrowserGovernanceService.requestAction({
        sessionId: "session-1",
        userId: "user-1",
        agentId: "browser",
        actionType: "SCROLL",
        targetUrl: "https://example.com",
        description: "Scroll page",
      });

      expect(result.approved).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("requires approval for SUBMIT_FORM", async () => {
      const { evaluateGovernance } = await import("@/lib/governance/policy-engine");
      vi.mocked(evaluateGovernance).mockResolvedValue({
        allowed: false,
        requiresApproval: true,
        approvalId: "approval-1",
        ruleIds: ["RULE-USER-CONTROL-001"],
        reason: "Action requires explicit user approval (EXTERNAL_ACTION)",
      });

      const result = await BrowserGovernanceService.requestAction({
        sessionId: "session-1",
        userId: "user-1",
        agentId: "browser",
        actionType: "SUBMIT_FORM",
        targetUrl: "https://example.com/form",
        description: "Submit login form",
      });

      expect(result.approved).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.approvalId).toBe("approval-1");
    });

    it("requires approval for PURCHASE", async () => {
      const { evaluateGovernance } = await import("@/lib/governance/policy-engine");
      vi.mocked(evaluateGovernance).mockResolvedValue({
        allowed: false,
        requiresApproval: true,
        approvalId: "approval-2",
        ruleIds: ["RULE-USER-CONTROL-001"],
        reason: "Action requires explicit user approval (HIGH_RISK)",
      });

      const result = await BrowserGovernanceService.requestAction({
        sessionId: "session-1",
        userId: "user-1",
        agentId: "browser",
        actionType: "PURCHASE",
        targetUrl: "https://shop.example.com/checkout",
        description: "Complete purchase",
      });

      expect(result.approved).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.ruleIds).toContain("RULE-USER-CONTROL-001");
    });

    it("requires approval for DELETE", async () => {
      const { evaluateGovernance } = await import("@/lib/governance/policy-engine");
      vi.mocked(evaluateGovernance).mockResolvedValue({
        allowed: false,
        requiresApproval: true,
        approvalId: "approval-3",
        ruleIds: ["RULE-USER-CONTROL-001", "RULE-USER-CONTROL-002"],
        reason: "Action requires explicit user approval (HIGH_RISK)",
      });

      const result = await BrowserGovernanceService.requestAction({
        sessionId: "session-1",
        userId: "user-1",
        agentId: "browser",
        actionType: "DELETE",
        targetUrl: "https://example.com/item/123",
        description: "Delete item",
      });

      expect(result.requiresApproval).toBe(true);
      expect(result.ruleIds).toContain("RULE-USER-CONTROL-002");
    });
  });

  describe("executeApprovedAction", () => {
    it("executes action after valid approval", async () => {
      const { verifyAndExecuteApproval } = await import("@/lib/governance/policy-engine");
      vi.mocked(verifyAndExecuteApproval).mockResolvedValue({ ok: true });

      const mockAuditCreate = vi.mocked(prisma.approvalAudit.create);
      mockAuditCreate.mockResolvedValue({} as any);

      const result = await BrowserGovernanceService.executeApprovedAction(
        "approval-1",
        "user-1",
        "SUBMIT_FORM",
        "https://example.com/form",
        { actionType: "SUBMIT_FORM", target: "https://example.com/form", method: "POST" }
      );

      expect(result.approved).toBe(true);
      expect(result.executed).toBe(true);
      expect(verifyAndExecuteApproval).toHaveBeenCalledWith(
        "approval-1",
        "user-1",
        expect.objectContaining({ actionType: "SUBMIT_FORM", target: "https://example.com/form" }),
        undefined
      );
    });

    it("rejects when hash validation fails", async () => {
      const { verifyAndExecuteApproval } = await import("@/lib/governance/policy-engine");
      vi.mocked(verifyAndExecuteApproval).mockResolvedValue({ ok: false, error: "hash mismatch" });

      const mockAuditCreate = vi.mocked(prisma.approvalAudit.create);
      mockAuditCreate.mockResolvedValue({} as any);

      const result = await BrowserGovernanceService.executeApprovedAction(
        "approval-1",
        "user-1",
        "SUBMIT_FORM",
        "https://example.com/form",
        { actionType: "SUBMIT_FORM", target: "https://example.com/other" }
      );

      expect(result.approved).toBe(false);
      expect(result.executed).toBe(false);
      expect(result.error).toBe("hash mismatch");
    });
  });

  describe("risk level classification", () => {
    it("classifies PURCHASE as HIGH_RISK", () => {
      expect(BrowserGovernanceService.getRiskLevel("PURCHASE")).toBe("HIGH_RISK");
    });

    it("classifies DELETE as HIGH_RISK", () => {
      expect(BrowserGovernanceService.getRiskLevel("DELETE")).toBe("HIGH_RISK");
    });

    it("classifies CLICK as EXTERNAL_ACTION", () => {
      expect(BrowserGovernanceService.getRiskLevel("CLICK")).toBe("EXTERNAL_ACTION");
    });

    it("classifies NAVIGATE as READ_ONLY", () => {
      expect(BrowserGovernanceService.getRiskLevel("NAVIGATE")).toBe("READ_ONLY");
    });
  });

  describe("emergencyStopAll", () => {
    it("calls emergency stop for user", async () => {
      const { emergencyStop } = await import("@/lib/governance/policy-engine");
      vi.mocked(emergencyStop).mockResolvedValue(undefined);

      await BrowserGovernanceService.emergencyStopAll("user-1");

      expect(emergencyStop).toHaveBeenCalledWith("user-1", undefined);
    });
  });
});
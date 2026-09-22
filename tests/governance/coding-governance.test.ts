import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodingGovernanceService } from "@/agents/coding/service/governance";
import { evaluateGovernance, verifyAndExecuteApproval } from "@/lib/governance/policy-engine";
import { prisma } from "@/database/client";

vi.mock("@/lib/governance/policy-engine", () => ({
  evaluateGovernance: vi.fn(),
  verifyAndExecuteApproval: vi.fn(),
  createFileAction: vi.fn((actionType: string, target: string, options: Record<string, unknown> = {}) => ({ actionType, target, ...options })),
  createCommandAction: vi.fn((command: string, workingDirectory: string, args: string[] = []) => ({ actionType: "COMMAND_EXECUTION", target: command, command, workingDirectory, arguments: args })),
  createGitAction: vi.fn((actionType: string, target: string, options: Record<string, unknown> = {}) => ({ actionType, target, ...options })),
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

describe("Coding Governance Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("requestAction", () => {
    it("allows read-only actions without approval", async () => {
      // Since READ_FILE is not in the type, we test that read-only is handled by the service
      // The service internally checks READ_ONLY_CODING set
      const { isReadOnly } = CodingGovernanceService;
      expect(isReadOnly("READ_FILE")).toBe(true);
    });

    it("requires approval for DELETE_FILE", async () => {
      const { evaluateGovernance } = await import("@/lib/governance/policy-engine");
      vi.mocked(evaluateGovernance).mockResolvedValue({
        allowed: false,
        requiresApproval: true,
        approvalId: "approval-1",
        ruleIds: ["RULE-USER-CONTROL-001", "RULE-USER-CONTROL-002"],
        reason: "Action requires explicit user approval (HIGH_RISK)",
      });

      const result = await CodingGovernanceService.requestAction({
        workspaceId: "ws-1",
        userId: "user-1",
        agentId: "coding",
        actionType: "DELETE_FILE",
        target: "/project/test.ts",
        description: "Delete test file",
        filePath: "/project/test.ts",
      });

      expect(result.requiresApproval).toBe(true);
      // ruleIds is on the governance decision, not the service result
    });

    it("requires approval for EDIT_FILE", async () => {
      const { evaluateGovernance } = await import("@/lib/governance/policy-engine");
      vi.mocked(evaluateGovernance).mockResolvedValue({
        allowed: false,
        requiresApproval: true,
        approvalId: "approval-2",
        ruleIds: ["RULE-USER-CONTROL-001", "RULE-USER-CONTROL-004"],
        reason: "Action requires explicit user approval (WRITE)",
      });

      const result = await CodingGovernanceService.requestAction({
        workspaceId: "ws-1",
        userId: "user-1",
        agentId: "coding",
        actionType: "EDIT_FILE",
        target: "/project/test.ts",
        description: "Edit test file",
        filePath: "/project/test.ts",
        newContent: "new content",
      });

      expect(result.requiresApproval).toBe(true);
    });

    it("requires approval for RUN_COMMAND", async () => {
      const { evaluateGovernance } = await import("@/lib/governance/policy-engine");
      vi.mocked(evaluateGovernance).mockResolvedValue({
        allowed: false,
        requiresApproval: true,
        approvalId: "approval-3",
        ruleIds: ["RULE-USER-CONTROL-001", "RULE-USER-CONTROL-003"],
        reason: "Action requires explicit user approval (COMMAND_EXECUTION)",
      });

      const result = await CodingGovernanceService.requestAction({
        workspaceId: "ws-1",
        userId: "user-1",
        agentId: "coding",
        actionType: "RUN_COMMAND",
        target: "npm run build",
        description: "Run build command",
        command: "npm",
        workingDirectory: "/project",
        args: ["run", "build"],
      });

      expect(result.requiresApproval).toBe(true);
    });

    it("requires approval for GIT_PUSH", async () => {
      const { evaluateGovernance } = await import("@/lib/governance/policy-engine");
      vi.mocked(evaluateGovernance).mockResolvedValue({
        allowed: false,
        requiresApproval: true,
        approvalId: "approval-4",
        ruleIds: ["RULE-USER-CONTROL-001"],
        reason: "Action requires explicit user approval (COMMAND_EXECUTION)",
      });

      const result = await CodingGovernanceService.requestAction({
        workspaceId: "ws-1",
        userId: "user-1",
        agentId: "coding",
        actionType: "GIT_PUSH",
        target: "origin/main",
        description: "Push to main branch",
        gitRef: "main",
      });

      expect(result.requiresApproval).toBe(true);
    });

    it("requires approval for INSTALL_DEPENDENCY", async () => {
      const { evaluateGovernance } = await import("@/lib/governance/policy-engine");
      vi.mocked(evaluateGovernance).mockResolvedValue({
        allowed: false,
        requiresApproval: true,
        approvalId: "approval-5",
        ruleIds: ["RULE-USER-CONTROL-001"],
        reason: "Action requires explicit user approval (COMMAND_EXECUTION)",
      });

      const result = await CodingGovernanceService.requestAction({
        workspaceId: "ws-1",
        userId: "user-1",
        agentId: "coding",
        actionType: "INSTALL_DEPENDENCY",
        target: "npm install lodash",
        description: "Install lodash",
        command: "npm",
        args: ["install", "lodash"],
        workingDirectory: "/project",
      });

      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("executeApprovedAction", () => {
    it("executes action after valid approval", async () => {
      const { verifyAndExecuteApproval } = await import("@/lib/governance/policy-engine");
      vi.mocked(verifyAndExecuteApproval).mockResolvedValue({ ok: true });

      const mockAuditCreate = vi.mocked(prisma.approvalAudit.create);
      mockAuditCreate.mockResolvedValue({} as any);

      const result = await CodingGovernanceService.executeApprovedAction(
        "approval-1",
        "user-1",
        "EDIT_FILE",
        "/project/test.ts",
        { actionType: "EDIT_FILE", target: "/project/test.ts", filePath: "/project/test.ts", newContent: "new content" }
      );

      expect(result.approved).toBe(true);
      expect(result.executed).toBe(true);
    });

    it("rejects when hash validation fails", async () => {
      const { verifyAndExecuteApproval } = await import("@/lib/governance/policy-engine");
      vi.mocked(verifyAndExecuteApproval).mockResolvedValue({ ok: false, error: "hash mismatch" });

      const mockAuditCreate = vi.mocked(prisma.approvalAudit.create);
      mockAuditCreate.mockResolvedValue({} as any);

      const result = await CodingGovernanceService.executeApprovedAction(
        "approval-1",
        "user-1",
        "EDIT_FILE",
        "/project/test.ts",
        { actionType: "EDIT_FILE", target: "/project/other.ts", filePath: "/project/other.ts", newContent: "different content" }
      );

      expect(result.approved).toBe(false);
      expect(result.error).toBe("hash mismatch");
    });
  });

  describe("risk level classification", () => {
    it("classifies DELETE_FILE as HIGH_RISK", () => {
      expect(CodingGovernanceService.getRiskLevel("DELETE_FILE")).toBe("HIGH_RISK");
    });

    it("classifies RUN_COMMAND as COMMAND_EXECUTION", () => {
      expect(CodingGovernanceService.getRiskLevel("RUN_COMMAND")).toBe("COMMAND_EXECUTION");
    });

    it("classifies GIT_COMMIT as COMMAND_EXECUTION", () => {
      expect(CodingGovernanceService.getRiskLevel("GIT_COMMIT")).toBe("COMMAND_EXECUTION");
    });

    it("classifies EDIT_FILE as WRITE", () => {
      expect(CodingGovernanceService.getRiskLevel("EDIT_FILE")).toBe("WRITE");
    });
  });

  describe("action type checks", () => {
    it("identifies destructive actions", () => {
      expect(CodingGovernanceService.isDestructive("DELETE_FILE")).toBe(true);
      expect(CodingGovernanceService.isDestructive("GIT_RESET")).toBe(true);
      expect(CodingGovernanceService.isDestructive("GIT_FORCE_PUSH")).toBe(true);
      expect(CodingGovernanceService.isDestructive("DEPLOY")).toBe(true);
    });

    it("identifies modification actions", () => {
      expect(CodingGovernanceService.isModification("EDIT_FILE")).toBe(true);
      expect(CodingGovernanceService.isModification("CREATE_FILE")).toBe(true);
      expect(CodingGovernanceService.isModification("RENAME_FILE")).toBe(true);
    });

    it("identifies execution actions", () => {
      expect(CodingGovernanceService.isExecution("RUN_COMMAND")).toBe(true);
      expect(CodingGovernanceService.isExecution("INSTALL_DEPENDENCY")).toBe(true);
      expect(CodingGovernanceService.isExecution("RUN_TESTS")).toBe(true);
    });

    it("identifies git write actions", () => {
      expect(CodingGovernanceService.isGitWrite("GIT_COMMIT")).toBe(true);
      expect(CodingGovernanceService.isGitWrite("GIT_PUSH")).toBe(true);
    });
  });

  describe("emergencyStopAll", () => {
    it("calls emergency stop for user", async () => {
      const { emergencyStop } = await import("@/lib/governance/policy-engine");
      vi.mocked(emergencyStop).mockResolvedValue(undefined);

      await CodingGovernanceService.emergencyStopAll("user-1");

      expect(emergencyStop).toHaveBeenCalledWith("user-1", undefined);
    });
  });
});
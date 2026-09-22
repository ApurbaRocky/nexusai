import { describe, it, expect } from "vitest";
import {
  createApprovalHash,
  verifyApprovalHash,
  createFileActionCanonical,
  createCommandActionCanonical,
  createBrowserActionCanonical,
  createDatabaseActionCanonical,
  createGitActionCanonical,
  type CanonicalAction,
} from "@/lib/governance/approval-hash";

describe("Approval Hash Integrity", () => {
  describe("createApprovalHash", () => {
    it("creates consistent hash for same action", () => {
      const action: CanonicalAction = {
        actionType: "DELETE",
        target: "/project/test.txt",
        filePath: "/project/test.txt",
      };

      const hash1 = createApprovalHash(action);
      const hash2 = createApprovalHash(action);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex
    });

    it("creates different hashes for different actions", () => {
      const action1: CanonicalAction = { actionType: "DELETE", target: "/project/test.txt" };
      const action2: CanonicalAction = { actionType: "DELETE", target: "/project/other.txt" };

      const hash1 = createApprovalHash(action1);
      const hash2 = createApprovalHash(action2);

      expect(hash1).not.toBe(hash2);
    });

    it("is order-independent for object keys", () => {
      const action1: CanonicalAction = { actionType: "DELETE", target: "/project/test.txt", extra: "value" };
      const action2: CanonicalAction = { extra: "value", target: "/project/test.txt", actionType: "DELETE" };

      const hash1 = createApprovalHash(action1);
      const hash2 = createApprovalHash(action2);

      expect(hash1).toBe(hash2);
    });
  });

  describe("verifyApprovalHash", () => {
    it("returns true for matching action and hash", () => {
      const action: CanonicalAction = {
        actionType: "COMMAND_EXECUTION",
        target: "npm run build",
        command: "npm run build",
        workingDirectory: "/project",
      };

      const hash = createApprovalHash(action);
      const isValid = verifyApprovalHash(hash, action);

      expect(isValid).toBe(true);
    });

    it("returns false for modified action", () => {
      const originalAction: CanonicalAction = {
        actionType: "DELETE",
        target: "/project/test.txt",
        filePath: "/project/test.txt",
      };

      const modifiedAction: CanonicalAction = {
        actionType: "DELETE",
        target: "/project/test.txt",
        filePath: "/project/other.txt", // Changed!
      };

      const hash = createApprovalHash(originalAction);
      const isValid = verifyApprovalHash(hash, modifiedAction);

      expect(isValid).toBe(false);
    });

    it("returns false for expanded target (wildcard)", () => {
      const approvedAction: CanonicalAction = {
        actionType: "DELETE",
        target: "/project/test.txt",
      };

      const actualAction: CanonicalAction = {
        actionType: "DELETE",
        target: "/project/*", // Expanded!
      };

      const hash = createApprovalHash(approvedAction);
      const isValid = verifyApprovalHash(hash, actualAction);

      expect(isValid).toBe(false);
    });
  });

  describe("createFileActionCanonical", () => {
    it("creates canonical action for file creation", () => {
      const action = createFileActionCanonical("CREATE", "/project/new-file.ts", {
        newContent: "export const x = 1;",
      });

      expect(action.actionType).toBe("CREATE");
      expect(action.target).toBe("/project/new-file.ts");
      expect(action.filePath).toBe("/project/new-file.ts");
      expect(action.newContent).toBe("export const x = 1;");
    });

    it("creates canonical action for file deletion", () => {
      const action = createFileActionCanonical("DELETE", "/project/old-file.ts");

      expect(action.actionType).toBe("DELETE");
      expect(action.target).toBe("/project/old-file.ts");
      expect(action.filePath).toBe("/project/old-file.ts");
    });

    it("creates canonical action for file rename", () => {
      const action = createFileActionCanonical("RENAME", "/project/old-name.ts", {
        newPath: "/project/new-name.ts",
      });

      expect(action.actionType).toBe("RENAME");
      expect(action.target).toBe("/project/old-name.ts");
      expect(action.newPath).toBe("/project/new-name.ts");
    });
  });

  describe("createCommandActionCanonical", () => {
    it("creates canonical action for command execution", () => {
      const action = createCommandActionCanonical(
        "npm",
        "/project",
        ["run", "build"],
        { NODE_ENV: "production" }
      );

      expect(action.actionType).toBe("COMMAND_EXECUTION");
      expect(action.target).toBe("npm");
      expect(action.command).toBe("npm");
      expect(action.workingDirectory).toBe("/project");
      expect(action.arguments).toEqual(["run", "build"]);
      expect(action.environmentScope).toEqual({ NODE_ENV: "production" });
    });
  });

  describe("createBrowserActionCanonical", () => {
    it("creates canonical action for browser form submission", () => {
      const action = createBrowserActionCanonical("SUBMIT_FORM", "https://example.com/form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { username: "test" },
      });

      expect(action.actionType).toBe("SUBMIT_FORM");
      expect(action.target).toBe("https://example.com/form");
      expect(action.method).toBe("POST");
      expect(action.headers).toEqual({ "Content-Type": "application/json" });
      expect(action.body).toEqual({ username: "test" });
    });
  });

  describe("createDatabaseActionCanonical", () => {
    it("creates canonical action for database delete", () => {
      const action = createDatabaseActionCanonical("DELETE", "users", {
        query: "DELETE FROM users WHERE id = 1",
        affectedCount: 1,
      });

      expect(action.actionType).toBe("DELETE");
      expect(action.target).toBe("users");
      expect(action.query).toBe("DELETE FROM users WHERE id = 1");
      expect(action.affectedCount).toBe(1);
    });
  });

  describe("createGitActionCanonical", () => {
    it("creates canonical action for git push", () => {
      const action = createGitActionCanonical("PUSH", "origin/main", {
        ref: "main",
      });

      expect(action.actionType).toBe("PUSH");
      expect(action.target).toBe("origin/main");
      expect(action.ref).toBe("main");
    });

    it("creates canonical action for git commit", () => {
      const action = createGitActionCanonical("COMMIT", "HEAD", {
        message: "feat: add new feature",
      });

      expect(action.actionType).toBe("COMMIT");
      expect(action.target).toBe("HEAD");
      expect(action.message).toBe("feat: add new feature");
    });
  });
});
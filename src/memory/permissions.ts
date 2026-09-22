/**
 * Phase 9 — Memory Permissions
 * Authorization and access control for memory operations
 */

import { prisma } from "@/database/client";
import { audit, type AuditContext } from "@/security/audit";
import type {
  MemoryScope,
  MemoryAccessOperation,
  MemoryRecord,
} from "./types";
import {
  canTransitionStatus,
  isOperationProtected,
  requiresApproval,
  agentCanAccessMemory,
  getAgentPermissions,
  PRIVACY_LEVEL_HIERARCHY,
} from "./policy";

export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  ruleIds: string[];
}

export interface MemoryAccessContext {
  userId: string;
  agentId?: string;
  operation: MemoryAccessOperation;
  memory?: MemoryRecord;
  scope?: MemoryScope;
  scopeId?: string;
  ip?: string;
  userAgent?: string;
}

export async function checkMemoryPermission(
  ctx: MemoryAccessContext
): Promise<PermissionCheckResult> {
  const { userId, agentId, operation, memory, scope, scopeId } = ctx;

  // Rule MEM-002: Cross-user isolation
  if (memory && memory.userId !== userId) {
    return {
      allowed: false,
      reason: "Cross-user memory access denied",
      requiresApproval: false,
      ruleIds: ["MEM-002"],
    };
  }

  // Check if operation is protected
  const protectedOp = isOperationProtected(operation);
  const needsApproval = protectedOp || Boolean(memory && requiresApproval(operation, memory.privacyLevel));

  // Check agent permissions
  if (agentId && !agentCanAccessMemory(agentId, operation, scope ?? "GLOBAL_USER", scopeId)) {
    return {
      allowed: false,
      reason: `Agent ${agentId} lacks permission for ${operation}`,
      requiresApproval: false,
      ruleIds: ["MEM-006"],
    };
  }

  // Check privacy level access
  if (memory && PRIVACY_LEVEL_HIERARCHY[memory.privacyLevel] > PRIVACY_LEVEL_HIERARCHY.NORMAL) {
    if (operation === "READ" || operation === "SEARCH") {
      // Allow read/search but may need approval for higher privacy
      if (memory.privacyLevel === "HIGHLY_PRIVATE" && !memory.userConfirmed) {
        return {
          allowed: false,
          reason: "Highly private memory requires user confirmation",
          requiresApproval: true,
          ruleIds: ["MEM-004"],
        };
      }
    }
  }

  // Check status transitions
  if (memory && operation === "UPDATE" && memory.status !== "ACTIVE") {
    if (!canTransitionStatus(memory.status, "ACTIVE")) {
      return {
        allowed: false,
        reason: `Cannot update memory with status ${memory.status}`,
        requiresApproval: false,
        ruleIds: ["MEM-003"],
      };
    }
  }

  // Scope isolation check
  if (memory && scope && memory.scope !== scope) {
    // Check if scope is a child of memory's scope
    const allowedScopes = getAllowedChildScopes(memory.scope);
    if (!allowedScopes.includes(scope)) {
      return {
        allowed: false,
        reason: `Scope ${scope} not allowed for memory with scope ${memory.scope}`,
        requiresApproval: false,
        ruleIds: ["MEM-003"],
      };
    }
  }

  return {
    allowed: true,
    reason: "Permission granted",
    requiresApproval: needsApproval,
    ruleIds: [],
  };
}

function getAllowedChildScopes(parentScope: MemoryScope): MemoryScope[] {
  const hierarchy: Record<MemoryScope, MemoryScope[]> = {
    GLOBAL_USER: ["PROJECT", "CONVERSATION", "TASK", "DOCUMENT_COLLECTION", "AGENT", "SESSION", "GLOBAL_USER"],
    PROJECT: ["CONVERSATION", "TASK", "DOCUMENT_COLLECTION", "PROJECT"],
    CONVERSATION: ["TASK", "CONVERSATION"],
    TASK: ["TASK"],
    DOCUMENT_COLLECTION: ["DOCUMENT_COLLECTION"],
    AGENT: ["AGENT"],
    SESSION: ["SESSION"],
  };
  return hierarchy[parentScope] ?? [];
}

export async function logMemoryAccess(
  memoryId: string,
  userId: string,
  operation: MemoryAccessOperation,
  success: boolean,
  ctx?: AuditContext,
  meta?: Record<string, unknown>
): Promise<void> {
  await prisma.memoryAccessLog.create({
    data: {
      memoryId,
      userId,
      operation,
      success,
      meta: meta ? JSON.stringify(meta) : null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    },
  });

  await audit("memory.access", { userId, ...ctx }, {
    memoryId,
    operation,
    success,
    ...meta,
  });
}

export async function validateMemoryOwnership(
  memoryId: string,
  userId: string
): Promise<MemoryRecord | null> {
  const memory = await prisma.memoryRecord.findFirst({
    where: { id: memoryId, userId },
  });
  return memory as unknown as MemoryRecord;
}

export function canUserManageMemory(
  userId: string,
  memory: MemoryRecord,
  operation: MemoryAccessOperation
): boolean {
  if (memory.userId !== userId) return false;

  // Users can always read their own memories
  if (operation === "READ" || operation === "SEARCH") return true;

  // Users can update/delete their own memories
  if (operation === "UPDATE" || operation === "DELETE" || operation === "ARCHIVE") {
    return memory.status === "ACTIVE" || memory.status === "ARCHIVED";
  }

  // Export requires explicit approval flow
  if (operation === "EXPORT" || operation === "SHARE") {
    return false; // Must go through approval
  }

  return false;
}

export function getRequiredApprovals(
  memory: MemoryRecord,
  operation: MemoryAccessOperation
): string[] {
  const approvals: string[] = [];

  if (operation === "DELETE") approvals.push("MEM-005");
  if (operation === "EXPORT") approvals.push("MEM-009");
  if (operation === "SHARE") approvals.push("MEM-010");
  if (memory.privacyLevel === "HIGHLY_PRIVATE") approvals.push("MEM-004");
  if (memory.privacyLevel === "PRIVATE" && operation === "CREATE") approvals.push("MEM-004");

  return approvals;
}

export function isMemoryOperationAllowed(
  userId: string,
  agentId: string | undefined,
  operation: MemoryAccessOperation,
  memory?: MemoryRecord,
  scope?: MemoryScope,
  scopeId?: string
): Promise<PermissionCheckResult> {
  return checkMemoryPermission({
    userId,
    agentId,
    operation,
    memory,
    scope,
    scopeId,
  });
}

export function filterMemoriesByPermission(
  memories: MemoryRecord[],
  userId: string,
  agentId?: string,
  operation: MemoryAccessOperation = "READ"
): MemoryRecord[] {
  return memories.filter((memory) => {
    // Check ownership
    if (memory.userId !== userId) return false;

    // Check agent permissions
    if (agentId) {
      const permissions = getAgentPermissions(agentId);
      if (!permissions.includes(operation)) return false;
    }

    // Check status
    if (operation !== "READ" && operation !== "SEARCH") {
      if (memory.status !== "ACTIVE") return false;
    }

    return true;
  });
}
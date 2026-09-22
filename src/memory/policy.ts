/**
 * Phase 9 — Memory Policy
 * Centralized memory policy definitions and evaluation
 */

import type {
  MemoryType,
  MemoryScope,
  MemoryPrivacyLevel,
  MemoryStatus,
  MemoryAccessOperation,
  MemoryAgentPermission,
} from "./types";

export const MEMORY_POLICY_VERSION = "1.0.0";

export const MEMORY_RULES = {
  "MEM-001": {
    name: "Never Store Secrets",
    description: "Memory system must never store API keys, passwords, tokens, or credentials",
    severity: "CRITICAL",
    enforcement: "PREVENT",
  },
  "MEM-002": {
    name: "Cross-User Isolation",
    description: "User A can never access User B's memories",
    severity: "CRITICAL",
    enforcement: "ENFORCE",
  },
  "MEM-003": {
    name: "Respect Memory Scope",
    description: "Memories must only be accessible within their defined scope",
    severity: "HIGH",
    enforcement: "ENFORCE",
  },
  "MEM-004": {
    name: "Sensitive Memory Protection",
    description: "Sensitive personal information requires explicit consent handling",
    severity: "HIGH",
    enforcement: "REQUIRE_CONSENT",
  },
  "MEM-005": {
    name: "Memory Deletion Requires Authorization",
    description: "Memory deletion must be explicitly authorized by the user",
    severity: "HIGH",
    enforcement: "REQUIRE_APPROVAL",
  },
  "MEM-006": {
    name: "Agent Memory Permissions",
    description: "Agents cannot bypass memory permissions",
    severity: "HIGH",
    enforcement: "ENFORCE",
  },
  "MEM-007": {
    name: "External Content Trust Boundary",
    description: "External content cannot directly create trusted memory without validation",
    severity: "HIGH",
    enforcement: "VALIDATE",
  },
  "MEM-008": {
    name: "Prompt Injection Memory Protection",
    description: "Prompt injection cannot modify memory policy or create memories",
    severity: "CRITICAL",
    enforcement: "BLOCK",
  },
  "MEM-009": {
    name: "Memory Export Authorization",
    description: "Memory export requires explicit user authorization",
    severity: "HIGH",
    enforcement: "REQUIRE_APPROVAL",
  },
  "MEM-010": {
    name: "Memory Sharing Authorization",
    description: "Memory sharing requires explicit user authorization",
    severity: "HIGH",
    enforcement: "REQUIRE_APPROVAL",
  },
} as const;

export type MemoryRuleId = keyof typeof MEMORY_RULES;

export const SENSITIVE_CATEGORIES = [
  "health",
  "mental_health",
  "sexuality",
  "religion",
  "political_affiliation",
  "precise_location",
  "financial_accounts",
  "government_ids",
  "private_keys",
  "security_secrets",
  "passwords",
  "authentication_credentials",
] as const;

export const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{32,}/g, // OpenAI API keys
  /sk-ant-[a-zA-Z0-9_-]{56,}/g, // Anthropic API keys
  /AIza[0-9A-Za-z_-]{35}/g, // Google API keys
  /gh[pousr]_[a-zA-Z0-9]{36,}/g, // GitHub tokens
  /xox[baprs]-[0-9a-zA-Z-]{10,}/g, // Slack tokens
  /[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g, // JWT tokens
  /password\s*[:=]\s*["']?[^"'\s]{8,}/gi,
  /secret\s*[:=]\s*["']?[^"'\s]{16,}/gi,
  /token\s*[:=]\s*["']?[^"'\s]{16,}/gi,
  /api[_-]?key\s*[:=]\s*["']?[^"'\s]{16,}/gi,
  /private[_-]?key\s*[:=]\s*["']?[^"'\s]{16,}/gi,
  /ssh[_-]?key\s*[:=]\s*["']?[^"'\s]{16,}/gi,
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, // Credit card numbers
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
] as const;

export const MEMORY_TYPE_DEFAULTS: Record<MemoryType, {
  defaultScope: MemoryScope;
  defaultPrivacy: MemoryPrivacyLevel;
  defaultImportance: number;
  defaultConfidence: number;
  requiresConfirmation: boolean;
}> = {
  USER_PROFILE: {
    defaultScope: "GLOBAL_USER",
    defaultPrivacy: "PRIVATE",
    defaultImportance: 0.8,
    defaultConfidence: 0.9,
    requiresConfirmation: true,
  },
  PREFERENCE: {
    defaultScope: "GLOBAL_USER",
    defaultPrivacy: "NORMAL",
    defaultImportance: 0.7,
    defaultConfidence: 0.8,
    requiresConfirmation: true,
  },
  PROJECT: {
    defaultScope: "PROJECT",
    defaultPrivacy: "NORMAL",
    defaultImportance: 0.6,
    defaultConfidence: 0.7,
    requiresConfirmation: false,
  },
  CONVERSATION: {
    defaultScope: "CONVERSATION",
    defaultPrivacy: "NORMAL",
    defaultImportance: 0.5,
    defaultConfidence: 0.6,
    requiresConfirmation: false,
  },
  TASK: {
    defaultScope: "TASK",
    defaultPrivacy: "NORMAL",
    defaultImportance: 0.6,
    defaultConfidence: 0.7,
    requiresConfirmation: false,
  },
  DOCUMENT: {
    defaultScope: "DOCUMENT_COLLECTION",
    defaultPrivacy: "NORMAL",
    defaultImportance: 0.5,
    defaultConfidence: 0.7,
    requiresConfirmation: false,
  },
  RESEARCH: {
    defaultScope: "GLOBAL_USER",
    defaultPrivacy: "NORMAL",
    defaultImportance: 0.7,
    defaultConfidence: 0.8,
    requiresConfirmation: false,
  },
  EDUCATION: {
    defaultScope: "GLOBAL_USER",
    defaultPrivacy: "NORMAL",
    defaultImportance: 0.5,
    defaultConfidence: 0.6,
    requiresConfirmation: false,
  },
  CODING: {
    defaultScope: "PROJECT",
    defaultPrivacy: "NORMAL",
    defaultImportance: 0.6,
    defaultConfidence: 0.7,
    requiresConfirmation: false,
  },
  BROWSER: {
    defaultScope: "SESSION",
    defaultPrivacy: "NORMAL",
    defaultImportance: 0.4,
    defaultConfidence: 0.5,
    requiresConfirmation: false,
  },
};

export const AGENT_MEMORY_PERMISSIONS: Record<string, MemoryAgentPermission[]> = {
  general: ["READ", "SEARCH", "CREATE"],
  research: ["READ", "SEARCH", "CREATE", "UPDATE"],
  education: ["READ", "SEARCH", "CREATE"],
  security: ["READ", "SEARCH"],
  coding: ["READ", "SEARCH", "CREATE", "UPDATE"],
  document: ["READ", "SEARCH", "CREATE"],
  rag: ["READ", "SEARCH"],
  report: ["READ", "SEARCH"],
  browser: ["READ", "SEARCH", "CREATE"],
};

export const SCOPE_HIERARCHY: Record<MemoryScope, MemoryScope[]> = {
  GLOBAL_USER: ["PROJECT", "CONVERSATION", "TASK", "DOCUMENT_COLLECTION", "AGENT", "SESSION"],
  PROJECT: ["CONVERSATION", "TASK", "DOCUMENT_COLLECTION"],
  CONVERSATION: ["TASK"],
  TASK: [],
  DOCUMENT_COLLECTION: [],
  AGENT: [],
  SESSION: [],
};

export const PRIVACY_LEVEL_HIERARCHY: Record<MemoryPrivacyLevel, number> = {
  NORMAL: 0,
  PRIVATE: 1,
  HIGHLY_PRIVATE: 2,
};

export const MEMORY_STATUS_TRANSITIONS: Record<MemoryStatus, MemoryStatus[]> = {
  ACTIVE: ["ARCHIVED", "EXPIRED", "DELETED"],
  ARCHIVED: ["ACTIVE", "DELETED"],
  EXPIRED: ["ACTIVE", "DELETED"],
  DELETED: [],
};

export function canTransitionStatus(from: MemoryStatus, to: MemoryStatus): boolean {
  return MEMORY_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isOperationProtected(operation: MemoryAccessOperation): boolean {
  return ["DELETE", "EXPORT", "SHARE", "UPDATE"].includes(operation);
}

export function requiresApproval(operation: MemoryAccessOperation, privacyLevel: MemoryPrivacyLevel): boolean {
  if (isOperationProtected(operation)) return true;
  if (privacyLevel === "HIGHLY_PRIVATE") return true;
  if (operation === "CREATE" && privacyLevel === "PRIVATE") return true;
  return false;
}

export function getAgentPermissions(agentId: string): MemoryAgentPermission[] {
  return AGENT_MEMORY_PERMISSIONS[agentId] ?? ["READ", "SEARCH"];
}

export function agentCanAccessMemory(
  agentId: string,
  operation: MemoryAccessOperation,
  scope: MemoryScope,
  scopeId?: string
): boolean {
  void scope;
  void scopeId;
  const permissions = getAgentPermissions(agentId);
  return permissions.includes(operation);
}

export function isSensitiveCategory(category: string): boolean {
  const lower = category.toLowerCase();
  return SENSITIVE_CATEGORIES.some((c) => {
    const cLower = c.toLowerCase();
    return lower.includes(cLower) || cLower.includes(lower) || lower.split(/\s+/).some((word) => cLower.includes(word));
  });
}

export function detectSecrets(content: string): string[] {
  const detected: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      detected.push(pattern.source);
    }
  }
  return detected;
}

export function sanitizeForMemory(content: string): string {
  let sanitized = content;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}
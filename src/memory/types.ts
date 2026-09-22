/**
 * Phase 9 — Memory Types
 * Core type definitions for the memory system
 */

export type MemoryType =
  | "USER_PROFILE"
  | "PREFERENCE"
  | "PROJECT"
  | "CONVERSATION"
  | "TASK"
  | "DOCUMENT"
  | "RESEARCH"
  | "EDUCATION"
  | "CODING"
  | "BROWSER";

export type MemoryScope =
  | "GLOBAL_USER"
  | "PROJECT"
  | "CONVERSATION"
  | "TASK"
  | "DOCUMENT_COLLECTION"
  | "AGENT"
  | "SESSION";

export type MemorySourceType =
  | "conversation"
  | "document"
  | "research"
  | "task"
  | "education"
  | "coding"
  | "browser"
  | "user_explicit"
  | "agent_inference";

export type MemoryPrivacyLevel = "NORMAL" | "PRIVATE" | "HIGHLY_PRIVATE";

export type MemoryStatus = "ACTIVE" | "ARCHIVED" | "EXPIRED" | "DELETED";

export type MemoryConflictType =
  | "CONTRADICTION"
  | "DUPLICATE"
  | "OUTDATED"
  | "SCOPE_MISMATCH";

export type MemoryConflictResolution =
  | "KEEP_FIRST"
  | "KEEP_SECOND"
  | "MERGE"
  | "USER_DECIDED"
  | "PENDING";

export type MemoryAccessOperation =
  | "READ"
  | "SEARCH"
  | "CREATE"
  | "UPDATE"
  | "ARCHIVE"
  | "DELETE"
  | "EXPORT"
  | "SHARE";

export type MemoryAgentPermission =
  | "READ"
  | "SEARCH"
  | "CREATE"
  | "UPDATE"
  | "ARCHIVE"
  | "DELETE"
  | "EXPORT"
  | "SHARE";

export type KnowledgeEntityType =
  | "User"
  | "Project"
  | "Technology"
  | "Skill"
  | "Document"
  | "ResearchTopic"
  | "Subject"
  | "Course"
  | "Task"
  | "Agent"
  | "Website"
  | "Organization"
  | "Concept"
  | "Preference"
  | "Goal";

export type KnowledgeRelationshipType =
  | "PREFERS"
  | "USES"
  | "WORKS_ON"
  | "STUDIES"
  | "READS"
  | "RELATED_TO"
  | "DEPENDS_ON"
  | "COMPLETED"
  | "INTERESTED_IN"
  | "CREATED"
  | "REFERENCES"
  | "HAS_GOAL"
  | "HAS_TASK";

export interface MemoryProvenance {
  sourceType: MemorySourceType;
  sourceId?: string;
  conversationId?: string;
  messageId?: string;
  documentId?: string;
  documentPage?: number;
  documentChunk?: string;
  researchSessionId?: string;
  researchFindingId?: string;
  taskId?: string;
  agentId?: string;
  userConfirmed?: boolean;
  extractedAt?: Date;
  extractionConfidence?: number;
}

export interface MemoryRecord {
  id: string;
  userId: string;
  projectId?: string | null;
  conversationId?: string | null;
  taskId?: string | null;
  documentId?: string | null;

  type: MemoryType;
  scope: MemoryScope;
  title?: string | null;
  content: string;
  summary?: string | null;
  importance: number;
  confidence: number;

  sourceType: MemorySourceType;
  sourceId?: string | null;
  provenance?: MemoryProvenance | null;

  embedding?: number[] | null;
  tags: string[];
  entities: string[];

  privacyLevel: MemoryPrivacyLevel;
  userVisible: boolean;
  userConfirmed: boolean;
  status: MemoryStatus;
  version: number;

  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date | null;
  expiresAt?: Date | null;
}

export interface MemoryVersion {
  id: string;
  memoryId: string;
  userId: string;
  content: string;
  summary?: string | null;
  importance: number;
  confidence: number;
  tags?: string[] | null;
  entities?: string[] | null;
  changedBy: "user" | "agent" | "system" | "extraction";
  changeReason?: string | null;
  version: number;
  createdAt: Date;
}

export interface MemoryEmbedding {
  id: string;
  memoryId: string;
  vector: number[];
  model: string;
  dimensions: number;
  createdAt: Date;
}

export interface MemoryTag {
  id: string;
  memoryId: string;
  tag: string;
  createdAt: Date;
}

export interface MemoryConflict {
  id: string;
  userId: string;
  memoryId: string;
  conflictingMemoryId: string;
  conflictType: MemoryConflictType;
  description: string;
  resolution?: MemoryConflictResolution | null;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryAccessLog {
  id: string;
  memoryId: string;
  userId: string;
  agentId?: string | null;
  operation: MemoryAccessOperation;
  success: boolean;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

export interface MemoryConsent {
  id: string;
  userId: string;
  memoryId: string;
  scope: MemoryScope;
  agentId?: string | null;
  granted: boolean;
  createdAt: Date;
  revokedAt?: Date | null;
}

export interface MemoryRetentionPolicy {
  id: string;
  userId: string;
  type: "GLOBAL" | "TYPE" | "SCOPE" | "PROJECT";
  targetValue?: string | null;
  maxAgeDays?: number | null;
  maxCount?: number | null;
  minImportance?: number | null;
  autoArchive: boolean;
  autoDelete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryScopeRecord {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeEntity {
  id: string;
  userId: string;
  name: string;
  type: KnowledgeEntityType;
  description?: string | null;
  properties?: Record<string, unknown> | null;
  confidence: number;
  importance: number;
  sourceType: MemorySourceType;
  sourceId?: string | null;
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date | null;
}

export interface KnowledgeRelationship {
  id: string;
  userId: string;
  sourceEntityId: string;
  targetEntityId: string;
  type: KnowledgeRelationshipType;
  confidence: number;
  weight: number;
  properties?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeEvidence {
  id: string;
  userId: string;
  entityId?: string | null;
  relationshipId?: string | null;
  sourceType: MemorySourceType;
  sourceId: string;
  excerpt?: string | null;
  confidence: number;
  createdAt: Date;
}

export interface MemoryAgentPermissionRecord {
  id: string;
  userId: string;
  agentId: string;
  permission: MemoryAgentPermission;
  scope: MemoryScope;
  scopeId?: string | null;
  granted: boolean;
  createdAt: Date;
  revokedAt?: Date | null;
}

export interface MemoryExportRecord {
  id: string;
  userId: string;
  memoryId: string;
  format: "JSON" | "CSV" | "MARKDOWN";
  content: string;
  createdAt: Date;
}

export interface MemorySearchQuery {
  query?: string;
  userId: string;
  types?: MemoryType[];
  scopes?: MemoryScope[];
  projectId?: string;
  conversationId?: string;
  taskId?: string;
  tags?: string[];
  entities?: string[];
  minImportance?: number;
  minConfidence?: number;
  maxResults?: number;
  includeArchived?: boolean;
  includeExpired?: boolean;
}

export interface MemorySearchResult {
  memory: MemoryRecord;
  score: number;
  matchedFields: string[];
}

export interface MemoryContext {
  memories: MemoryRecord[];
  totalTokens: number;
  truncated: boolean;
}

export interface MemoryExtractionCandidate {
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  sourceType: MemorySourceType;
  sourceId?: string;
  importance: number;
  confidence: number;
  entities: string[];
  tags: string[];
  provenance: MemoryProvenance;
}

export interface MemoryExtractionResult {
  candidates: MemoryExtractionCandidate[];
  filteredCount: number;
  duplicatesFound: number;
  sensitiveFiltered: number;
}

export interface MemoryUpdatePayload {
  content?: string;
  title?: string;
  summary?: string;
  importance?: number;
  confidence?: number;
  tags?: string[];
  entities?: string[];
  privacyLevel?: MemoryPrivacyLevel;
  userVisible?: boolean;
  status?: MemoryStatus;
  expiresAt?: Date | null;
}

export interface MemoryCreateInput {
  userId: string;
  type: MemoryType;
  scope: MemoryScope;
  content: string;
  title?: string;
  summary?: string;
  importance?: number;
  confidence?: number;
  projectId?: string;
  conversationId?: string;
  taskId?: string;
  documentId?: string;
  sourceType: MemorySourceType;
  sourceId?: string;
  provenance?: MemoryProvenance;
  tags?: string[];
  entities?: string[];
  privacyLevel?: MemoryPrivacyLevel;
  userVisible?: boolean;
  userConfirmed?: boolean;
  expiresAt?: Date;
}

export interface KnowledgeGraphSearchQuery {
  userId: string;
  entityName?: string;
  entityType?: KnowledgeEntityType;
  relationshipType?: KnowledgeRelationshipType;
  maxDepth?: number;
  maxResults?: number;
}

export interface KnowledgeGraphSearchResult {
  entities: KnowledgeEntity[];
  relationships: KnowledgeRelationship[];
  paths: KnowledgeGraphPath[];
}

export interface KnowledgeGraphPath {
  entities: KnowledgeEntity[];
  relationships: KnowledgeRelationship[];
  totalWeight: number;
}
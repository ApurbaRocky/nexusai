/**
 * Phase 9 — Knowledge Graph
 * Personal Knowledge Graph for entities and relationships
 */

import { prisma } from "@/database/client";
import { log } from "@/utils/log";
import type {
  KnowledgeEntity,
  KnowledgeRelationship,
  KnowledgeEvidence,
  KnowledgeEntityType,
  KnowledgeRelationshipType,
  KnowledgeGraphSearchQuery,
  KnowledgeGraphSearchResult,
  KnowledgeGraphPath,
  MemoryProvenance,
  MemorySourceType,
} from "./types";

interface GraphEntityRow {
  id: string;
  userId?: string;
  name?: string;
  type?: string;
  description?: string | null;
  properties?: string | null;
  confidence?: number;
  importance?: number;
  sourceType?: string;
  sourceId?: string | null;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
  lastAccessedAt?: Date | null;
  relationships?: GraphRelationshipRow[];
  inverseRelationships?: GraphRelationshipRow[];
}

interface GraphRelationshipRow {
  id?: string;
  userId?: string;
  sourceEntityId: string;
  targetEntityId: string;
  type?: string;
  confidence?: number;
  weight?: number;
  properties?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  targetEntity?: GraphEntityRow;
  sourceEntity?: GraphEntityRow;
}

export interface EntityExtractionResult {
  entities: Array<{
    name: string;
    type: KnowledgeEntityType;
    description?: string;
    confidence: number;
    properties?: Record<string, unknown>;
  }>;
  relationships: Array<{
    source: string;
    target: string;
    type: KnowledgeRelationshipType;
    confidence: number;
    properties?: Record<string, unknown>;
  }>;
}
export class KnowledgeGraphService {
  async extractEntitiesAndRelationships(
    text: string,
    userId: string,
    provenance: MemoryProvenance
  ): Promise<EntityExtractionResult> {
    if (text.length < 50) return { entities: [], relationships: [] };

    try {
      // In production, use AI to extract
      // For now, use simple pattern matching
      return this.simpleExtraction(text, userId, provenance);
    } catch (err) {
      log.error("entity-extraction-failed", { error: (err as Error).message });
      return { entities: [], relationships: [] };
    }
  }

  private simpleExtraction(
    text: string,
    userId: string,
    provenance: MemoryProvenance
  ): EntityExtractionResult {
    const entities: EntityExtractionResult["entities"] = [];
    const relationships: EntityExtractionResult["relationships"] = [];

    // Extract technology mentions
    const techPatterns = [
      /\b(React|Next\.js|TypeScript|JavaScript|Python|Node\.js|PostgreSQL|SQLite|Prisma|Tailwind|Vercel|Docker|Kubernetes|AWS|GCP|Azure)\b/g,
      /\b(OpenAI|Anthropic|Gemini|Claude|GPT|LLM|RAG|vector|embedding)\b/g,
    ];

    for (const pattern of techPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        entities.push({
          name: match[0],
          type: "Technology",
          description: `Technology mentioned in ${provenance.sourceType}`,
          confidence: 0.7,
          properties: { source: provenance.sourceType, sourceId: provenance.sourceId },
        });
      }
    }

    // Extract project names (capitalized words that might be project names)
    const projectMatches = text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:project|app|application|system|platform)\b/gi);
    for (const match of projectMatches) {
      entities.push({
        name: match[1],
        type: "Project",
        description: `Project mentioned in ${provenance.sourceType}`,
        confidence: 0.6,
        properties: { source: provenance.sourceType, sourceId: provenance.sourceId },
      });
    }

    return { entities, relationships };
  }

  async upsertEntity(
    userId: string,
    entity: {
      name: string;
      type: KnowledgeEntityType;
      description?: string;
      properties?: Record<string, unknown>;
      confidence: number;
      sourceType: MemorySourceType;
      sourceId?: string;
    },
    provenance?: MemoryProvenance
  ): Promise<KnowledgeEntity> {
    // Check if entity exists
    const existing = await prisma.knowledgeEntity.findUnique({
      where: {
        userId_type_name: {
          userId,
          type: entity.type,
          name: entity.name,
        },
      },
    });

    if (existing) {
      // Update confidence and properties
      const updated = await prisma.knowledgeEntity.update({
        where: { id: existing.id },
        data: {
          confidence: Math.max(existing.confidence, entity.confidence),
          importance: Math.max(existing.importance, entity.confidence * 0.5),
          description: entity.description ?? existing.description,
          properties: entity.properties ? JSON.stringify(entity.properties) : existing.properties,
          lastAccessedAt: new Date(),
        },
      });

      // Add evidence
      if (provenance) {
        await this.addEvidence(userId, updated.id, null, provenanceToEvidence(provenance));
      }

      return this.mapEntity(updated);
    }

    // Create new entity
    const created = await prisma.knowledgeEntity.create({
      data: {
        userId,
        name: entity.name,
        type: entity.type,
        description: entity.description ?? "",
        properties: entity.properties ? JSON.stringify(entity.properties) : null,
        confidence: entity.confidence,
        importance: entity.confidence * 0.5,
        sourceType: entity.sourceType,
        sourceId: entity.sourceId ?? null,
        status: "ACTIVE",
      },
    });

    if (provenance) {
      await this.addEvidence(userId, created.id, null, provenanceToEvidence(provenance));
    }

    return this.mapEntity(created);
  }

  async upsertRelationship(
    userId: string,
    relationship: {
      sourceEntityName: string;
      sourceEntityType: KnowledgeEntityType;
      targetEntityName: string;
      targetEntityType: KnowledgeEntityType;
      type: KnowledgeRelationshipType;
      confidence: number;
      properties?: Record<string, unknown>;
      sourceType: MemorySourceType;
      sourceId?: string;
    },
    provenance?: MemoryProvenance
  ): Promise<KnowledgeRelationship | null> {
    // Get or create source entity
    const source = await this.upsertEntity(userId, {
      name: relationship.sourceEntityName,
      type: relationship.sourceEntityType,
      confidence: relationship.confidence,
      sourceType: relationship.sourceType,
      sourceId: relationship.sourceId,
    }, {
      sourceType: relationship.sourceType,
      sourceId: relationship.sourceId,
    });

    // Get or create target entity
    const target = await this.upsertEntity(userId, {
      name: relationship.targetEntityName,
      type: relationship.targetEntityType,
      confidence: relationship.confidence,
      sourceType: relationship.sourceType,
      sourceId: relationship.sourceId,
    }, {
      sourceType: relationship.sourceType,
      sourceId: relationship.sourceId,
    });

    if (source.id === target.id) return null;

    // Check if relationship exists
    const existing = await prisma.knowledgeRelationship.findUnique({
      where: {
        sourceEntityId_targetEntityId_type: {
          sourceEntityId: source.id,
          targetEntityId: target.id,
          type: relationship.type,
        },
      },
    });

    if (existing) {
      const updated = await prisma.knowledgeRelationship.update({
        where: { id: existing.id },
        data: {
          confidence: Math.max(existing.confidence, relationship.confidence),
          weight: Math.max(existing.weight, relationship.confidence),
          properties: relationship.properties ? JSON.stringify(relationship.properties) : existing.properties,
        },
      });

      if (provenance) {
        await this.addEvidence(userId, null, updated.id, provenanceToEvidence({
          ...provenance,
          sourceType: relationship.sourceType,
          sourceId: relationship.sourceId,
        }));
      }

      return this.mapRelationship(updated);
    }

    // Create new relationship
    const created = await prisma.knowledgeRelationship.create({
      data: {
        userId,
        sourceEntityId: source.id,
        targetEntityId: target.id,
        type: relationship.type,
        confidence: relationship.confidence,
        weight: relationship.confidence,
        properties: relationship.properties ? JSON.stringify(relationship.properties) : null,
      },
    });

    if (provenance) {
      await this.addEvidence(userId, null, created.id, provenanceToEvidence({
        ...provenance,
        sourceType: relationship.sourceType,
        sourceId: relationship.sourceId,
      }));
    }

    return this.mapRelationship(created);
  }

  private async addEvidence(
    userId: string,
    entityId: string | null,
    relationshipId: string | null,
    evidence: Omit<KnowledgeEvidence, "id" | "userId" | "entityId" | "relationshipId" | "createdAt">
  ): Promise<void> {
    await prisma.knowledgeEvidence.create({
      data: {
        userId,
        entityId,
        relationshipId,
        sourceType: evidence.sourceType,
        sourceId: evidence.sourceId,
        excerpt: evidence.excerpt,
        confidence: evidence.confidence,
      },
    });
  }

  async searchGraph(query: KnowledgeGraphSearchQuery): Promise<KnowledgeGraphSearchResult> {
    const { userId, entityName, entityType, relationshipType, maxDepth = 2, maxResults = 20 } = query;

    const entityWhere: Record<string, unknown> = { userId, status: "ACTIVE" };
    if (entityName) entityWhere.name = { contains: entityName, mode: "insensitive" };
    if (entityType) entityWhere.type = entityType;

    const entities = await prisma.knowledgeEntity.findMany({
      where: entityWhere,
      take: maxResults,
      include: {
        relationships: {
          where: relationshipType ? { type: relationshipType } : undefined,
          take: maxDepth * 5,
          include: { targetEntity: true },
        },
        inverseRelationships: {
          where: relationshipType ? { type: relationshipType } : undefined,
          take: maxDepth * 5,
          include: { sourceEntity: true },
        },
      },
    });

    // Build paths
    const paths = this.buildPaths(entities, maxDepth);

    // Collect all relationships
    const allRelationships: KnowledgeRelationship[] = [];
    for (const entity of entities) {
      allRelationships.push(...entity.relationships.map((r) => this.mapRelationship(r)));
      allRelationships.push(...entity.inverseRelationships.map((r) => this.mapRelationship(r)));
    }

    return {
      entities: entities.map((e) => this.mapEntity(e)),
      relationships: allRelationships,
      paths,
    };
  }

  private buildPaths(
    entities: GraphEntityRow[],
    maxDepth: number
  ): KnowledgeGraphPath[] {
    const paths: KnowledgeGraphPath[] = [];

    for (const entity of entities) {
      // Simple 1-hop paths
      for (const rel of entity.relationships ?? []) {
        if (!rel.targetEntity) continue;
        paths.push({
          entities: [this.mapEntity(entity), this.mapEntity(rel.targetEntity)],
          relationships: [this.mapRelationship(rel)],
          totalWeight: rel.weight ?? 1.0,
        });
      }

      // 2-hop paths
      if (maxDepth >= 2) {
        for (const rel of entity.relationships ?? []) {
          if (!rel.targetEntity) continue;
          for (const rel2 of rel.targetEntity.relationships ?? []) {
            if (!rel2.targetEntity) continue;
            if (rel2.targetEntityId !== entity.id) {
              paths.push({
                entities: [
                  this.mapEntity(entity),
                  this.mapEntity(rel.targetEntity),
                  this.mapEntity(rel2.targetEntity),
                ],
                relationships: [this.mapRelationship(rel), this.mapRelationship(rel2)],
                totalWeight: (rel.weight ?? 1.0) * (rel2.weight ?? 1.0),
              });
            }
          }
        }
      }
    }

    // Sort by weight
    paths.sort((a, b) => b.totalWeight - a.totalWeight);
    return paths.slice(0, 50);
  }

  async getEntityNeighbors(
    userId: string,
    entityId: string,
    maxDepth = 1
  ): Promise<{ entities: KnowledgeEntity[]; relationships: KnowledgeRelationship[] }> {
    void maxDepth;
    const entity = await prisma.knowledgeEntity.findFirst({
      where: { id: entityId, userId },
      include: {
        relationships: { include: { targetEntity: true } },
        inverseRelationships: { include: { sourceEntity: true } },
      },
    });

    if (!entity) return { entities: [], relationships: [] };

    const entities = [this.mapEntity(entity)];
    const relationships: KnowledgeRelationship[] = [];

    for (const rel of entity.relationships) {
      entities.push(this.mapEntity(rel.targetEntity));
      relationships.push(this.mapRelationship(rel));
    }
    for (const rel of entity.inverseRelationships) {
      entities.push(this.mapEntity(rel.sourceEntity));
      relationships.push(this.mapRelationship(rel));
    }

    // Deduplicate
    const uniqueEntities = entities.filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i);
    const uniqueRelationships = relationships.filter(
      (r, i, arr) => arr.findIndex((x) => x.id === r.id) === i
    );

    return { entities: uniqueEntities, relationships: uniqueRelationships };
  }

  async getUserGraphSummary(userId: string): Promise<{
    entityCount: number;
    relationshipCount: number;
    entitiesByType: Record<string, number>;
    topEntities: KnowledgeEntity[];
  }> {
    const [entityCount, relationshipCount, entitiesByType, topEntities] = await Promise.all([
      prisma.knowledgeEntity.count({ where: { userId, status: "ACTIVE" } }),
      prisma.knowledgeRelationship.count({ where: { userId } }),
      prisma.knowledgeEntity.groupBy({
        by: ["type"],
        where: { userId, status: "ACTIVE" },
        _count: true,
      }),
      prisma.knowledgeEntity.findMany({
        where: { userId, status: "ACTIVE" },
        orderBy: { importance: "desc" },
        take: 10,
      }),
    ]);

    return {
      entityCount,
      relationshipCount,
      entitiesByType: Object.fromEntries(entitiesByType.map((e) => [e.type, e._count])),
      topEntities: topEntities.map((e) => this.mapEntity(e)),
    };
  }

  private mapEntity(row: GraphEntityRow | KnowledgeEntity): KnowledgeEntity {
    const source = row as GraphEntityRow;
    return {
      id: source.id,
      userId: source.userId ?? "",
      name: source.name ?? "",
      type: (source.type ?? "Concept") as KnowledgeEntityType,
      description: source.description ?? null,
      properties: source.properties ? JSON.parse(source.properties) : null,
      confidence: source.confidence ?? 0,
      importance: source.importance ?? 0,
      sourceType: (source.sourceType ?? "conversation") as MemorySourceType,
      sourceId: source.sourceId ?? null,
      status: (source.status ?? "ACTIVE") as "ACTIVE" | "ARCHIVED" | "DELETED",
      createdAt: new Date(source.createdAt ?? Date.now()),
      updatedAt: new Date(source.updatedAt ?? Date.now()),
      lastAccessedAt: source.lastAccessedAt ? new Date(source.lastAccessedAt) : null,
    };
  }

  private mapRelationship(row: GraphRelationshipRow | KnowledgeRelationship): KnowledgeRelationship {
    const source = row as GraphRelationshipRow;
    return {
      id: source.id ?? "",
      userId: source.userId ?? "",
      sourceEntityId: source.sourceEntityId,
      targetEntityId: source.targetEntityId,
      type: (source.type ?? "RELATED_TO") as KnowledgeRelationshipType,
      confidence: source.confidence ?? 0,
      weight: source.weight ?? 1,
      properties: source.properties ? JSON.parse(source.properties) : null,
      createdAt: new Date(source.createdAt ?? Date.now()),
      updatedAt: new Date(source.updatedAt ?? Date.now()),
    };
  }

  /*
  private mapEntity(row: {
    id: string;
    userId: string;
    name: string;
    type: string;
    description: string | null;
    properties: string | null;
    confidence: number;
    importance: number;
    sourceType: string;
    sourceId: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    lastAccessedAt: Date | null;
  }): KnowledgeEntity {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      type: row.type as KnowledgeEntityType,
      description: row.description,
      properties: row.properties ? JSON.parse(row.properties) : null,
      confidence: row.confidence,
      importance: row.importance,
      sourceType: row.sourceType as MemorySourceType,
      sourceId: row.sourceId,
      status: row.status as "ACTIVE" | "ARCHIVED" | "DELETED",
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      lastAccessedAt: row.lastAccessedAt ? new Date(row.lastAccessedAt) : null,
    };
  }

  private mapRelationship(row: {
    id: string;
    userId: string;
    sourceEntityId: string;
    targetEntityId: string;
    type: string;
    confidence: number;
    weight: number;
    properties: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): KnowledgeRelationship {
    return {
      id: row.id,
      userId: row.userId,
      sourceEntityId: row.sourceEntityId,
      targetEntityId: row.targetEntityId,
      type: row.type as KnowledgeRelationshipType,
      confidence: row.confidence,
      weight: row.weight,
      properties: row.properties ? JSON.parse(row.properties) : null,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }
  */
}

function provenanceToEvidence(provenance: MemoryProvenance): Omit<KnowledgeEvidence, "id" | "userId" | "entityId" | "relationshipId" | "createdAt"> {
  return {
    sourceType: provenance.sourceType,
    sourceId: provenance.sourceId ?? provenance.conversationId ?? provenance.documentId ?? provenance.taskId ?? "unknown",
    excerpt: null,
    confidence: provenance.extractionConfidence ?? 0.5,
  };
}

export const knowledgeGraphService = new KnowledgeGraphService();
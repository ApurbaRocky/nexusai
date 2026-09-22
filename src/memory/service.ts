/**
 * Memory subsystem (spec §9): short-term (conversation), long-term
 * (user-approved), project-scoped. Users can view/edit/delete/disable.
 * Never stores secrets (API keys, passwords, tokens).
 */
import { prisma } from "@/database/client";

export type MemoryType = "long_term" | "project" | "preference";

export interface MemoryItem {
  id: string;
  type: MemoryType;
  content: string;
  source?: string | null;
  enabled: boolean;
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
}

function toMemoryItem(row: {
  id: string;
  type: string;
  content: string;
  source: string | null;
  enabled: boolean;
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MemoryItem {
  return {
    id: row.id,
    type: row.type as MemoryType,
    content: row.content,
    source: row.source,
    enabled: row.enabled,
    projectId: row.projectId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMemories(userId: string, projectId?: string): Promise<MemoryItem[]> {
  const rows = await prisma.memory.findMany({
    where: { userId, ...(projectId ? { projectId } : {}) },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toMemoryItem);
}

export async function addMemory(
  userId: string,
  input: { content: string; type?: MemoryType; projectId?: string; source?: string },
): Promise<MemoryItem> {
  const row = await prisma.memory.create({
    data: {
      userId,
      content: input.content,
      type: input.type ?? "long_term",
      projectId: input.projectId ?? null,
      source: input.source ?? null,
    },
  });
  return toMemoryItem(row);
}

export async function updateMemory(userId: string, id: string, patch: { content?: string; enabled?: boolean; type?: MemoryType }): Promise<MemoryItem | null> {
  const existing = await prisma.memory.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const row = await prisma.memory.update({
    where: { id },
    data: {
      content: patch.content ?? existing.content,
      enabled: patch.enabled ?? existing.enabled,
      type: patch.type ?? existing.type,
    },
  });
  return toMemoryItem(row);
}

export async function deleteMemory(userId: string, id: string): Promise<boolean> {
  const existing = await prisma.memory.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await prisma.memory.delete({ where: { id } });
  return true;
}

export async function memoryBlockText(userId: string, projectId?: string, limit = 4000): Promise<string> {
  const items = await listMemories(userId, projectId);
  const enabled = items.filter((m) => m.enabled);
  if (!enabled.length) return "";
  const header = projectId ? "Project memories:" : "Long-term memories:";
  const text = enabled
    .map((m, i) => `${i + 1}. (${m.type}) ${m.content}`)
    .join("\n");
  return `${header}\n${text}`.slice(0, limit);
}
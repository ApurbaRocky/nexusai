/**
 * Prisma client singleton with driver-adapter support (Prisma 7).
 *
 * The active adapter is chosen from DATABASE_URL:
 *   - `postgres://...c`  -> PrismaPg adapter
 *   - `file:...`         -> better-sqlite3 adapter (local development)
 *
 * NOTE: This module is server-only. Import it only inside Server Components,
 * Route Handlers, or Server Actions.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import path from "node:path";
import "server-only";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const isPostgres = url.startsWith("postgres");
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NODE_ENV === "production" && !isBuild && !isPostgres) {
    throw new Error("Production runtime requires a PostgreSQL DATABASE_URL.");
  }

  const adapter = isPostgres
    ? new PrismaPg({ connectionString: url })
    : new PrismaBetterSqlite3({ url: toSqlitePath(url) });

  return new PrismaClient({ adapter });
}

function toSqlitePath(url: string): string {
  if (url === "file:./dev.db" || url === "file:./prisma/dev.db") {
    // Mirror the CLI default path so `prisma migrate dev` and the app agree.
    return path.resolve("prisma", "dev.db");
  }
  const match = /^file:(.+)$/.exec(url);
  if (match) {
    const p = match[1];
    return path.resolve(p);
  }
  return path.resolve(url);
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
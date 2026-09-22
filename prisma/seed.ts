import { hashPassword } from "../src/auth/password";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ainexus.local";
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "NexusAdmin!2026";

const dbUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const adapter = new PrismaBetterSqlite3({ url: dbUrl.replace(/^file:/, "") });
const prisma = new PrismaClient({ adapter });

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: SEED_ADMIN_EMAIL } });
  let user;
  if (existing) {
    user = existing;
    console.log(`Admin already exists: ${SEED_ADMIN_EMAIL} (skipped)`);
  } else {
    user = await prisma.user.create({
      data: {
        name: "AI Nexus Admin",
        email: SEED_ADMIN_EMAIL,
        role: "admin",
        passwordHash: await hashPassword(SEED_ADMIN_PASSWORD),
      },
    });
    console.log(`Created admin: ${SEED_ADMIN_EMAIL} / ${SEED_ADMIN_PASSWORD}`);
  }

  const memoryCount = await prisma.memory.count({ where: { userId: user.id } });
  if (memoryCount === 0) {
    await prisma.memory.createMany({
      data: [
        { userId: user.id, type: "preference", content: "Prefers concise, evidence-based answers with citations.", source: "seed" },
        { userId: user.id, type: "project", content: "Building AI Nexus as a personal multi-agent assistant platform.", source: "seed" },
      ],
    });
    console.log("Seeded starter memories.");
  }

  // Ensure the built-in agents are recorded in the Agent table for tool-call provenance joins.
  const agentIds = ["assistant", "research", "education", "security", "coding", "document"];
  for (const id of agentIds) {
    const existingAgent = await prisma.agent.findUnique({ where: { id } });
    if (!existingAgent) {
      await prisma.agent.create({
        data: {
          id,
          name: id.charAt(0).toUpperCase() + id.slice(1),
          description: `${id} agent`,
          enabled: true,
        },
      });
    }
  }
  console.log("Agents ensured.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
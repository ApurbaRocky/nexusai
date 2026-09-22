// temp script to store API key via env var (never written to disk)
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { encryptSecret, last4 } from "@/security/crypto";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const adapter = new PrismaBetterSqlite3({
  url: url.startsWith("file:") ? path.resolve(url.slice(5)) : path.resolve("prisma", "dev.db"),
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const apiKey = process.env.STORE_KEY;
  if (!apiKey) {
    console.error("STORE_KEY env var not set");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email: "admin@ainexus.local" },
  });
  if (!user) {
    console.error("User admin@ainexus.local not found");
    process.exit(1);
  }

  const encrypted = encryptSecret(apiKey);
  const l4 = last4(apiKey);

  await prisma.apiKey.upsert({
    where: { userId_provider_name: { userId: user.id, provider: "openai", name: "Default" } },
    update: { encryptedKey: encrypted.ciphertext, iv: encrypted.iv, last4: l4, updatedAt: new Date() },
    create: { userId: user.id, provider: "openai", name: "Default", encryptedKey: encrypted.ciphertext, iv: encrypted.iv, last4: l4 },
  });

  // Audit log directly (skip the audit module which pulls in server-only)
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "api_key.create",
      category: "SECURITY",
      ip: "127.0.0.1",
      userAgent: "cli",
      meta: JSON.stringify({ provider: "openai", name: "Default", last4: l4, source: "cli" }),
    },
  }).catch(() => {}); // audit must never break primary flow

  console.log(JSON.stringify({ ok: true, user: user.email, provider: "openai", name: "Default", last4: l4 }));
}

main().finally(() => prisma.$disconnect());
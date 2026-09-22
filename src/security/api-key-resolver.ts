/**
 * Server-side resolution of the active API key for a provider.
 * Order: user-supplied encrypted key (per-user) -> server env key -> none.
 */
import { prisma } from "@/database/client";
import { decryptSecret } from "@/security/crypto";
import { config } from "@/config";

export type ProviderKeySource = "user" | "server" | "none";

export async function getUserApiKey(userId: string, provider: string): Promise<string | undefined> {
  const row = await prisma.apiKey.findFirst({
    where: { userId, provider, isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return undefined;
  try {
    return decryptSecret(row.encryptedKey, row.iv);
  } catch {
    return undefined;
  }
}

export function getServerApiKey(provider: string): string {
  switch (provider) {
    case "openai":
      return config.OPENAI_API_KEY;
    case "anthropic":
      return config.ANTHROPIC_API_KEY;
    case "gemini":
      return config.GOOGLE_AI_API_KEY;
    default:
      return "";
  }
}

export async function resolveKeySource(
  userId: string,
  provider: string,
): Promise<{ source: ProviderKeySource; apiKey?: string }> {
  if (provider === "local" || provider === "demo") return { source: "none" };
  const userKey = await getUserApiKey(userId, provider);
  if (userKey) return { source: "user", apiKey: userKey };
  const serverKey = getServerApiKey(provider);
  if (serverKey) return { source: "server", apiKey: serverKey };
  return { source: "none" };
}
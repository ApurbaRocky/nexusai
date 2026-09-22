import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { getAvailableModels } from "@/ai/providers/registry";
import { listAgents } from "@/agents/agents/registry";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const models = await getAvailableModels(authed.user.id);
  const agents = listAgents().map((a) => ({
    id: a.id,
    name: a.name,
    tagline: a.tagline,
    description: a.description,
    capabilities: a.capabilities,
    icon: a.icon,
  }));

  return NextResponse.json({
    demoEnabled: models.some((m) => m.provider === "demo" && m.available),
    models: models.map((m) => ({
      id: m.id,
      provider: m.provider,
      label: m.label,
      contextWindow: m.contextWindow,
      supportsTools: m.supportsTools,
      supportsVision: m.supportsVision,
      mock: m.mock ?? false,
      available: m.available,
      reason: m.reason,
      keySource: m.keySource,
    })),
    providers: [
      { id: "openai", label: "OpenAI", configured: models.some((m) => m.provider === "openai" && m.available) },
      { id: "anthropic", label: "Anthropic", configured: models.some((m) => m.provider === "anthropic" && m.available) },
      { id: "gemini", label: "Google Gemini", configured: models.some((m) => m.provider === "gemini" && m.available) },
      { id: "local", label: "Local Models", configured: true },
      { id: "demo", label: "Demo (MOCK)", configured: models.some((m) => m.provider === "demo" && m.available) },
    ],
    agents,
  });
}
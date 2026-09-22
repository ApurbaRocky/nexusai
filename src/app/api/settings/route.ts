import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { settingsSchema } from "@/security/validate";
import { prisma } from "@/database/client";

export const dynamic = "force-dynamic";

function safeJson(json?: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function GET(_request: NextRequest) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;

  const user = await prisma.user.findUnique({ where: { id: authed.user.id }, select: { name: true, email: true, role: true, settings: true } });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  return NextResponse.json({
    profile: { name: user.name, email: user.email, role: user.role },
    settings: safeJson(user.settings),
  });
}

export async function PATCH(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const body = await request.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

  const user = await prisma.user.findUnique({ where: { id: authed.user.id }, select: { settings: true, name: true } });
  const current = safeJson(user?.settings);
  const { name, ...settings } = parsed.data;
  const next = { ...current, ...settings };

  await prisma.user.update({
    where: { id: authed.user.id },
    data: {
      ...(name ? { name } : {}),
      settings: JSON.stringify(next),
    },
  });

  return NextResponse.json({ ok: true, settings: next, profile: { name: name ?? user?.name ?? "" } });
}
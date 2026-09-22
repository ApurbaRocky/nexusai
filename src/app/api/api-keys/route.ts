import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import { encryptSecret, last4 } from "@/security/crypto";
import { audit } from "@/security/audit";
import { z } from "zod";
import { log } from "@/utils/log";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]),
  name: z.string().min(1).max(40).default("Default"),
  apiKey: z.string().min(8).max(400),
});

export async function GET(_request: NextRequest) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;

  const keys = await prisma.apiKey.findMany({ where: { userId: authed.user.id }, orderBy: { updatedAt: "desc" } });
  return NextResponse.json({
    keys: keys.map((k) => ({
      id: k.id,
      provider: k.provider,
      name: k.name,
      last4: k.last4,
      isActive: k.isActive,
      updatedAt: k.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

  const { ciphertext, iv } = encryptSecret(parsed.data.apiKey.trim());
  // Overwrite a same-provider default key rather than duplicating.
  const existing = await prisma.apiKey.findFirst({ where: { userId: authed.user.id, provider: parsed.data.provider, name: parsed.data.name } });

  let row;
  if (existing) {
    row = await prisma.apiKey.update({
      where: { id: existing.id },
      data: { encryptedKey: ciphertext, iv, last4: last4(parsed.data.apiKey) },
    });
  } else {
    row = await prisma.apiKey.create({
      data: {
        userId: authed.user.id,
        provider: parsed.data.provider,
        name: parsed.data.name,
        encryptedKey: ciphertext,
        iv,
        last4: last4(parsed.data.apiKey),
      },
    });
  }

  await audit("api_key.create", { userId: authed.user.id }, { provider: parsed.data.provider });
  return NextResponse.json(
    { ok: true, id: row.id, provider: row.provider, name: row.name, last4: row.last4 },
    { status: 201 },
  );
}

export async function DELETE(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing key id." }, { status: 422 });

  const existing = await prisma.apiKey.findFirst({ where: { id, userId: authed.user.id } });
  if (!existing) return NextResponse.json({ error: "Key not found." }, { status: 404 });

  await prisma.apiKey.delete({ where: { id } });
  await audit("api_key.delete", { userId: authed.user.id }, { provider: existing.provider });
  log.info("api-key-deleted", { provider: existing.provider });
  return NextResponse.json({ ok: true });
}
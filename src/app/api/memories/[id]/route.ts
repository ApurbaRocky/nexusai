import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { updateMemory, deleteMemory } from "@/memory/service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  content: z.string().min(1).max(4000).optional(),
  enabled: z.boolean().optional(),
  type: z.enum(["long_term", "project", "preference"]).optional(),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });

  const item = await updateMemory(authed.user.id, id, parsed.data);
  if (!item) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(_request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(_request);
  if (authed instanceof NextResponse) return authed;
  const { id } = await params;
  const ok = await deleteMemory(authed.user.id, id);
  if (!ok) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
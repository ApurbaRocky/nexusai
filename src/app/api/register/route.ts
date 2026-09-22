import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { registerSchema, validatePayload } from "@/security/validate";
import { requestContext } from "@/security/audit";
import { rateLimit, rateLimitHeaders } from "@/security/rate-limit";
import { hashPassword } from "@/auth/password";
import { prisma } from "@/database/client";
import { audit } from "@/security/audit";
import { signIn } from "@/auth/auth";
import { log } from "@/utils/log";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`register:${ipOf(request)}`, { limit: 20, windowMs: 60_000, prefix: "auth" }, requestContext(request.headers));
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests.", code: "RATE_LIMITED" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const ctx = requestContext(request.headers);
  const validated = await validatePayload(registerSchema, await request.json().catch(() => null), ctx);
  if (!validated.ok) return NextResponse.json({ error: validated.error, code: "VALIDATION" }, { status: 422 });

  const { email, password, name } = validated.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists.", code: "EMAIL_TAKEN" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const count = await prisma.user.count();
  const role = count === 0 ? "admin" : "user"; // first account becomes admin

  const user = await prisma.user.create({
    data: { email, name, passwordHash, role, settings: JSON.stringify({}) },
  });

  await audit("auth.register", { userId: user.id }, { role });

  // Establish session in the same round trip.
  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (err) {
    log.warn("register-auto-login-failed", { error: (err as Error).message });
  }

  return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}

function ipOf(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
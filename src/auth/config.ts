/**
 * Auth.js (NextAuth v5) configuration.
 * Credentials provider + JWT sessions. Passwords are bcrypt-hashed.
 * Session cookies are httpOnly, SameSite=Lax, secure in production.
 */
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { verifyPassword } from "@/auth/password";
import { prisma } from "@/database/client";
import { rateLimit } from "@/security/rate-limit";
import { audit } from "@/security/audit";

const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export const authConfig = {
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      id: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const rl = await rateLimit(`login:${email.toLowerCase()}`, {
          limit: 8,
          windowMs: 15 * 60 * 1000,
          prefix: "auth",
        });
        if (!rl.ok) return null;

        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user) {
          await audit("auth.login.failed", {}, { email: email.toLowerCase(), reason: "no_user" });
          return null;
        }
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          await audit("auth.login.failed", { userId: user.id }, { reason: "bad_password" });
          return null;
        }
        await audit("auth.login", { userId: user.id });
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.email = user.email;
        token.name = user.name;
        token.role = (user as { role?: string }).role ?? "user";
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) ?? "user";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
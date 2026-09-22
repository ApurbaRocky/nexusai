/**
 * Auth.js (NextAuth v5) HTTP endpoint.
 *
 * Next.js routes every auth action through this catch-all: sign-in, callbacks,
 * session reads, the CSRF token, and sign-out. Without this file credentials
 * sign-in returns 404 and — because the proxy guards the app shell — nobody can
 * reach the application at all.
 */
import { handlers } from "@/auth/auth";

// Auth responses depend on the incoming request (cookies, provider redirects)
// and must never be prerendered or cached.
export const dynamic = "force-dynamic";

export const { GET, POST } = handlers;

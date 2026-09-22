/**
 * API route guard: authorizes requests and enforces basic transport-level
 * CSRF / origin checks for state-changing endpoints.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth, type SessionUser } from "@/auth/auth";
import { config } from "@/config";

export interface AuthedRequest {
  user: SessionUser;
  request: NextRequest;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "API_ERROR",
    public retriable = false,
  ) {
    super(message);
  }
}

export interface GuardOptions {
  /** Reject cross-origin state-changing requests. Defaults to true for non-GET. */
  csrf?: boolean;
  /** Required minimum role. */
  role?: "user" | "admin";
}

export async function guard(request: NextRequest, options: GuardOptions = {}): Promise<AuthedRequest | NextResponse> {
  const { csrf = request.method !== "GET" } = options;

  if (csrf) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        return NextResponse.json({ error: "Invalid origin." }, { status: 400 });
      }
      if (originHost !== host && config.NODE_ENV !== "test") {
        return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
      }
    }
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "You must be signed in to access this resource.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const user: SessionUser = {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    role: session.user.role ?? "user",
  };

  if (options.role === "admin" && user.role !== "admin") {
    return NextResponse.json(
      { error: "Administrator access required.", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  return { user, request };
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code, retriable: error.retriable },
      { status: error.status },
    );
  }
  // Civility rule: friendly, generic HTTP-facing messages. Details stay in the
  // server logs (see src/utils/log.ts).
  console.error("[api]", error);
  return NextResponse.json(
    { error: "Something went wrong on our side.", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth/auth";
import { memoryRetriever } from "@/memory/retriever";
import { log } from "@/utils/log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const body = await req.json();
    const { query, options = {} } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Query is required" }, { status: 422 });
    }

    const result = await memoryRetriever.retrieve({
      query,
      userId,
      ...options,
    });

    return NextResponse.json(result);
  } catch (err) {
    log.error("memory-retrieve-failed", { error: (err as Error).message });
    return NextResponse.json({ error: "Failed to retrieve memories" }, { status: 500 });
  }
}
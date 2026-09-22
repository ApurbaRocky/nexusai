import { NextResponse } from "next/server";
import { auth } from "@/auth/auth";
import { memoryService } from "@/memory/service";
import { log } from "@/utils/log";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const stats = await memoryService.getMemoryStats(userId);
    return NextResponse.json(stats);
  } catch (err) {
    log.error("memory-stats-failed", { error: (err as Error).message });
    return NextResponse.json({ error: "Failed to get memory stats" }, { status: 500 });
  }
}
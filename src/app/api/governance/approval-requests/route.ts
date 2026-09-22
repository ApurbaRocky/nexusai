import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/database/client";
import { auth } from "@/auth/auth";
import { audit, type AuditContext } from "@/security/audit";
import { createApprovalHash, type CanonicalAction } from "@/lib/governance/approval-hash";
import { log } from "@/utils/log";

export const runtime = "nodejs";

function getAuthContext(req: NextRequest): AuditContext {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const ctx = getAuthContext(req);

  try {
    const body = await req.json();
    const {
      taskId,
      nodeId,
      agentId,
      toolId,
      actionType,
      target,
      description,
      riskLevel,
      exactAction,
      expiresInMs = 5 * 60 * 1000,
    } = body as {
      taskId?: string;
      nodeId?: string;
      agentId: string;
      toolId?: string;
      actionType: string;
      target: string;
      description: string;
      riskLevel: string;
      exactAction: CanonicalAction;
      expiresInMs?: number;
    };

    if (!agentId || !actionType || !target || !description || !riskLevel || !exactAction) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const canonicalAction: CanonicalAction = {
      ...exactAction,
      actionType,
      target,
    };

    const approvalHash = createApprovalHash(canonicalAction);
    const expiresAt = new Date(Date.now() + expiresInMs);

    const approval = await prisma.approvalRequest.create({
      data: {
        userId,
        taskId: taskId ?? null,
        nodeId: nodeId ?? null,
        agentId,
        toolId: toolId ?? null,
        actionType,
        target,
        description,
        riskLevel,
        exactAction: JSON.stringify(canonicalAction),
        approvalHash,
        expiresAt,
        status: "PENDING",
      },
    });

    await audit("approval.requested", { userId, ...ctx }, {
      approvalId: approval.id,
      actionType,
      target,
      riskLevel,
      taskId,
      nodeId,
      agentId,
    });

    await prisma.approvalAudit.create({
      data: {
        userId,
        approvalId: approval.id,
        actionType,
        target,
        riskLevel,
        event: "ACTION_REQUESTED",
        status: "PENDING",
        meta: JSON.stringify({ taskId, nodeId, agentId, toolId }),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });

    log.info("approval-created", { approvalId: approval.id, actionType, target, riskLevel });

    return NextResponse.json({
      id: approval.id,
      status: approval.status,
      expiresAt: approval.expiresAt.toISOString(),
      approvalHash,
    });
  } catch (err) {
    log.error("approval-create-failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Failed to create approval request" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const taskId = searchParams.get("taskId");
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  const where: Record<string, unknown> = { userId };
  if (status) where.status = status;
  if (taskId) where.taskId = taskId;

  const approvals = await prisma.approvalRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      task: { select: { id: true, title: true, goal: true } },
      node: { select: { id: true, title: true, type: true } },
    },
  });

  return NextResponse.json(approvals);
}
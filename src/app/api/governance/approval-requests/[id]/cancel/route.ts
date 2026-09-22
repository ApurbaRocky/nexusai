import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/database/client";
import { auth } from "@/auth/auth";
import { audit, type AuditContext } from "@/security/audit";
import { log } from "@/utils/log";

export const runtime = "nodejs";

function getAuthContext(req: NextRequest): AuditContext {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  };
}

async function getApproval(id: string, userId: string) {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id },
    include: { task: true, node: true },
  });

  if (!approval) return null;
  if (approval.userId !== userId) return null;
  if (approval.status !== "PENDING") return null;

  return approval;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;
  const ctx = getAuthContext(req);

  try {
    const approval = await getApproval(id, userId);
    if (!approval) {
      return NextResponse.json({ error: "Approval not found or already decided" }, { status: 404 });
    }

    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { status: "CANCELLED" },
    });

    await audit("approval.cancelled", { userId, ...ctx }, {
      approvalId: approval.id,
      actionType: approval.actionType,
      target: approval.target,
      riskLevel: approval.riskLevel,
      taskId: approval.taskId,
      nodeId: approval.nodeId,
    });

    await prisma.approvalAudit.create({
      data: {
        userId,
        approvalId: approval.id,
        actionType: approval.actionType,
        target: approval.target,
        riskLevel: approval.riskLevel,
        event: "APPROVAL_CANCELLED",
        status: "CANCELLED",
        meta: JSON.stringify({ taskId: approval.taskId, nodeId: approval.nodeId }),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });

    log.info("approval-cancelled", { approvalId: approval.id });

    return NextResponse.json({ id: approval.id, status: "CANCELLED" });
  } catch (err) {
    log.error("approval-cancel-failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/database/client";
import { auth } from "@/auth/auth";
import { audit, type AuditContext } from "@/security/audit";
import { verifyApprovalHash, type CanonicalAction } from "@/lib/governance/approval-hash";
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
    include: {
      task: true,
      node: true,
    },
  });

  if (!approval) return null;
  if (approval.userId !== userId) return null;
  if (approval.status !== "PENDING") return null;
  if (approval.expiresAt < new Date()) return null;

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
      return NextResponse.json({ error: "Approval not found, expired, or already decided" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const { exactAction } = body as { exactAction?: CanonicalAction };

    if (exactAction) {
      const isValid = verifyApprovalHash(approval.approvalHash, exactAction);
      if (!isValid) {
        await audit("approval.rejected", { userId, ...ctx }, {
          approvalId: approval.id,
          reason: "hash_mismatch",
          actionType: approval.actionType,
          target: approval.target,
        });

        await prisma.approvalAudit.create({
          data: {
            userId,
            approvalId: approval.id,
            actionType: approval.actionType,
            target: approval.target,
            riskLevel: approval.riskLevel,
            event: "ACTION_BLOCKED",
            status: "REJECTED",
            meta: JSON.stringify({ reason: "hash_mismatch", providedAction: exactAction }),
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
        });

        await prisma.approvalRequest.update({
          where: { id: approval.id },
          data: { status: "REJECTED", rejectedAt: new Date(), decidedBy: userId },
        });

        return NextResponse.json({ error: "Action does not match approved action (hash mismatch)" }, { status: 400 });
      }
    }

    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { status: "APPROVED", approvedAt: new Date(), decidedBy: userId },
    });

    await audit("approval.approved", { userId, ...ctx }, {
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
        event: "APPROVAL_APPROVED",
        status: "APPROVED",
        meta: JSON.stringify({ taskId: approval.taskId, nodeId: approval.nodeId }),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });

    log.info("approval-approved", { approvalId: approval.id });

    return NextResponse.json({ id: approval.id, status: "APPROVED", approvedAt: new Date().toISOString() });
  } catch (err) {
    log.error("approval-approve-failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Failed to approve" }, { status: 500 });
  }
}
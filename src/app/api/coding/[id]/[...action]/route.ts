import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { CodingAgent } from "@/agents/coding/agent";
import { codeSearch } from "@/agents/coding/code-search";
import { buildArchitecture } from "@/agents/coding/architecture";
import { readText } from "@/agents/coding/workspace";
import { prisma } from "@/database/client";
import { audit } from "@/security/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; action: string[] }>;
}

const jsonBody = (request: NextRequest) => request.json().catch(() => null);

export async function GET(request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const { id, action } = await params;
  const [head, ...rest] = action;

  const url = request.nextUrl;
  switch (head) {
    case "index":
      return handle(await CodingAgent.index(authed.user.id, id));

    case "search": {
      const q = url.searchParams.get("q") ?? "";
      const mode = (url.searchParams.get("mode") as "exact" | "word" | "symbol" | "semantic" | "auto") ?? "auto";
      const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 20) || 20);
      return handle(await codeSearch(id, authed.user.id, { query: q, mode, limit }));
    }

    case "architecture":
      return handle(await buildArchitecture(id, authed.user.id));

    case "symbols": {
      const file = url.searchParams.get("file") ?? undefined;
      const q = url.searchParams.get("q") ?? "";
      const syms = await prisma.codeSymbol.findMany({
        where: { workspaceId: id, ...(file ? { file: { path: file } } : {}), ...(q ? { name: { contains: q } } : {}) },
        select: { id: true, name: true, kind: true, lineStart: true, lineEnd: true, signature: true, access: true, file: { select: { path: true } } },
        orderBy: [{ file: { path: "asc" } }, { lineStart: "asc" }],
        take: 300,
      });
      return handle(syms);
    }

    case "dependencies": {
      const deps = await prisma.codeDependency.findMany({
        where: { workspaceId: id },
        distinct: ["target"],
        select: { target: true, isLocal: true, sourcePath: true, type: true },
        take: 300,
      });
      return handle(deps);
    }

    case "files":
      return handle(
        await prisma.codebaseFile.findMany({
          where: { workspaceId: id },
          select: { id: true, path: true, language: true, sizeBytes: true, lineCount: true, isTest: true, isConfig: true, isDoc: true, updatedAt: true },
          orderBy: { path: "asc" },
          take: 1000,
        }),
      );

    case "tasks": {
      const tasks = await prisma.codingTask.findMany({
        where: { workspaceId: id },
        include: { changes: { take: 20, orderBy: { createdAt: "asc" } }, testRuns: { take: 5, orderBy: { createdAt: "desc" } }, plans: { take: 1, orderBy: { createdAt: "desc" } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return handle(tasks);
    }

    case "git": {
      const actionParam = url.searchParams.get("action") ?? "status";
      return handle(await CodingAgent.gitOperation(authed.user.id, id, { action: actionParam, args: [] }));
    }

    case "file": {
      const filePath = rest.join("/");
      if (!filePath || filePath.includes("..")) return NextResponse.json({ error: "Invalid path." }, { status: 400 });
      const r = await readText(id, filePath);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 });
      return NextResponse.json({ path: filePath, content: r.content });
    }

    case "review":
      return handle(await CodingAgent.review(authed.user.id, id));
  }

  return NextResponse.json({ error: "Unknown coding endpoint." }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: RouteCtx) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const { id, action } = await params;
  const [head] = action;
  const body = await jsonBody(request);

  switch (head) {
    case "index": {
      const summary = await CodingAgent.index(authed.user.id, id);
      await audit("coding.index", { userId: authed.user.id }, { workspaceId: id, ...summary });
      return handle(summary);
    }

    case "ask": {
      const question = z.string().min(1).parse(body?.question ?? "");
      return handle(await CodingAgent.ask(authed.user.id, id, question));
    }

    case "plan": {
      const p = z.string().min(1).parse(body?.prompt ?? "");
      const plan = await CodingAgent.plan(authed.user.id, id, p);
      await audit("coding.plan", { userId: authed.user.id }, { workspaceId: id, taskId: plan.taskId });
      return handle(plan);
    }

    case "propose": {
      const p = z.string().min(1).parse(body?.prompt ?? "");
      const files = Array.isArray(body?.files) ? body.files.map(String) : undefined;
      const changes = await CodingAgent.proposeChanges(authed.user.id, id, { prompt: p, files });
      await audit("coding.change.propose", { userId: authed.user.id }, { workspaceId: id, changeCount: changes.length });
      return handle(changes);
    }

    case "apply": {
      const taskId = z.string().min(1).parse(body?.taskId ?? "");
      const confirmed = body?.confirmed === true;
      if (!confirmed) return NextResponse.json({ error: "Approval required." }, { status: 422 });
      const res = await CodingAgent.apply(taskId, {
        confirmed,
        runTests: body?.runTests !== false,
        testCommand: typeof body?.testCommand === "string" ? body.testCommand : undefined,
      });
      await audit("coding.change.apply", { userId: authed.user.id }, { workspaceId: id, taskId, applied: res.applied });
      return handle(res);
    }

    case "reject": {
      const taskId = z.string().min(1).parse(body?.taskId ?? "");
      await CodingAgent.rejectTask(taskId);
      await audit("coding.change.reject", { userId: authed.user.id }, { workspaceId: id, taskId });
      return NextResponse.json({ ok: true });
    }

    case "restore": {
      const snapshotId = z.string().min(1).parse(body?.snapshotId ?? "");
      const res = await CodingAgent.restore(authed.user.id, id, snapshotId);
      await audit("coding.restore", { userId: authed.user.id }, { workspaceId: id, snapshotId });
      return handle(res);
    }

    case "checkpoint": {
      const label = z.string().max(200).parse(body?.label ?? "manual checkpoint");
      const snapshotId = await CodingAgent.checkpoint(authed.user.id, id, label);
      return handle({ snapshotId });
    }

    case "review": {
      const files = Array.isArray(body?.files) ? body.files.map(String) : undefined;
      return handle(await CodingAgent.review(authed.user.id, id, files));
    }

    case "debug": {
      const symptom = z.string().min(1).parse(body?.symptom ?? "");
      return handle(await CodingAgent.debug(authed.user.id, id, symptom));
    }

    case "refactor": {
      const p = z.string().min(1).parse(body?.prompt ?? "");
      const files = Array.isArray(body?.files) ? body.files.map(String) : undefined;
      return handle(await CodingAgent.refactor(authed.user.id, id, p, files));
    }

    case "docs": {
      const p = z.string().min(1).parse(body?.prompt ?? "");
      const files = Array.isArray(body?.files) ? body.files.map(String) : undefined;
      return handle(await CodingAgent.docs(authed.user.id, id, p, files));
    }

    case "command": {
      const command = z.string().min(1).parse(body?.command ?? "");
      const args = Array.isArray(body?.args) ? body.args.map(String) : [];
      const confirmed = body?.confirmed === true;
      const res = await CodingAgent.run(authed.user.id, id, { command, args, confirmed });
      await audit("coding.command", { userId: authed.user.id }, { workspaceId: id, command: command.slice(0, 80), exitCode: res.exitCode });
      return handle({ exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, durationMs: res.durationMs, risk: res.risk.level });
    }

    case "test": {
      const command = typeof body?.command === "string" ? body.command : undefined;
      const taskId = typeof body?.taskId === "string" ? body.taskId : undefined;
      const res = await CodingAgent.test(authed.user.id, id, { command, taskId });
      await audit("coding.test", { userId: authed.user.id }, { workspaceId: id, command: command ?? "auto", exitCode: res.exitCode });
      return handle({ testRunId: res.testRunId, ok: res.ok, exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, durationMs: res.durationMs });
    }

    case "git": {
      const gaction = z.string().min(1).parse(body?.action ?? "");
      const args = Array.isArray(body?.args) ? body.args.map(String) : [];
      const confirmed = body?.confirmed === true;
      const res = await CodingAgent.gitOperation(authed.user.id, id, { action: gaction, args, confirmed });
      await audit("coding.git", { userId: authed.user.id }, { workspaceId: id, action: gaction, allowed: res.ok });
      return handle(res);
    }
  }

  return NextResponse.json({ error: "Unknown coding endpoint." }, { status: 404 });
}

function handle(data: unknown) {
  return NextResponse.json(data);
}
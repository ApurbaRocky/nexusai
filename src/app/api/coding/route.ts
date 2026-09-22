import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/auth/guard";
import { prisma } from "@/database/client";
import { CodingAgent } from "@/agents/coding/agent";
import { audit } from "@/security/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(""),
  projectId: z.string().optional(),
  sourceType: z.enum(["upload", "empty", "local"]).optional().default("empty"),
  localPath: z.string().optional(),
  ignorePatterns: z.array(z.string()).optional(),
  gitInit: z.boolean().optional().default(false),
  permissionLevel: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const workspaces = await prisma.codingWorkspace.findMany({
    where: { userId: authed.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      projectId: true,
      sourceType: true,
      status: true,
      language: true,
      framework: true,
      permissionLevel: true,
      indexError: true,
      lastIndexedAt: true,
      stats: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { files: true, tasks: true, changes: true, testRuns: true } },
    },
  });

  return NextResponse.json({ workspaces });
}

export async function POST(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;

  const contentType = request.headers.get("content-type") ?? "";
  let zip: Buffer | undefined;
  let fields: unknown = {};

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    fields = {
      name: (form.get("name") as string) ?? "Untitled workspace",
      description: (form.get("description") as string) ?? "",
      projectId: (form.get("projectId") as string) || undefined,
      sourceType: ((form.get("sourceType") as string) || "upload") as "upload",
      ignorePatterns: (form.get("ignorePatterns") as string)?.split(",").map((s) => s.trim()).filter(Boolean),
      gitInit: form.get("gitInit") === "true",
      permissionLevel: (form.get("permissionLevel") as string) || undefined,
    };
    const file = form.get("zip");
    if (file instanceof File) {
      zip = Buffer.from(await file.arrayBuffer());
    }
  } else {
    const body = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 422 });
    fields = parsed.data;
  }

  if (typeof (fields as { sourceType?: string }).sourceType === "string" && (fields as { sourceType: string }).sourceType === "local" && !(fields as { localPath?: string }).localPath) {
    return NextResponse.json({ error: "localPath is required for local workspaces." }, { status: 422 });
  }

  if ((fields as { sourceType?: string }).sourceType === "local" && authed.user.role !== "admin") {
    return NextResponse.json({ error: "Local filesystem workspaces require administrator access." }, { status: 403 });
  }

  try {
    const created = await CodingAgent.createWorkspace({
      ...(fields as Parameters<typeof CodingAgent.createWorkspace>[0]),
      userId: authed.user.id,
      zip,
    });
    await audit("coding.workspace.create", { userId: authed.user.id }, { workspaceId: created.workspace.id, name: created.workspace.name, imported: created.imported });
    return NextResponse.json({ workspace: created.workspace, imported: created.imported }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create workspace." }, { status: 400 });
  }
}
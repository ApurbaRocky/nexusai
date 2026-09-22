import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ApiError, guard } from "@/auth/guard";
import { chatSchema, validatePayload } from "@/security/validate";
import { rateLimit, rateLimitHeaders } from "@/security/rate-limit";
import { requestContext } from "@/security/audit";
import { prisma } from "@/database/client";
import { classifyRequest, getAgent } from "@/agents/agents/registry";
import { orchestrate, type OrchestrationResult } from "@/agents/orchestrator/orchestrator";
import { getProvider, getAvailableModels } from "@/ai/providers/registry";
import { resolveKeySource } from "@/security/api-key-resolver";
import type { ChatMessage, StreamEvent } from "@/types";
import { streamEvent } from "@/types";
import { lookupModel, MODEL_CATALOG } from "@/ai/model-catalog";
import { memoryRetriever } from "@/memory/retriever";
import { memoryExtractor } from "@/memory/extractor";
import { log } from "@/utils/log";
import type { ModelInfo } from "@/ai/providers/base";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const authed = await guard(request);
  if (authed instanceof NextResponse) return authed;
  const { user } = authed;

  const rl = await rateLimit(`chat:${user.id}`, { limit: 40, windowMs: 60_000, prefix: "chat" }, requestContext(request.headers));
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests. Please slow down.", code: "RATE_LIMITED" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const validated = await validatePayload(chatSchema, await request.json().catch(() => null), requestContext(request.headers));
  if (!validated.ok) return NextResponse.json({ error: validated.error, code: "VALIDATION" }, { status: 422 });

  const reqId = crypto.randomUUID();
  const payload = validated.data;

  // Model + agent resolution.
  const model = await resolveModel(user.id, payload.model);
  const key = await resolveKeySource(user.id, model.provider);
  const planning = classifyRequest(payload.content, {
    explicitAgent: payload.agent ?? undefined,
    hasAttachments: Boolean(payload.attachments?.length),
  });
  const agent = getAgent(planning.agentId);

  let provider;
  try {
    provider = getProvider(model.provider, key.apiKey);
  } catch {
    throw new ApiError(503, "AI provider unavailable.", "PROVIDER_UNAVAILABLE", true);
  }
  if (!model.mock && !provider.isConfigured({ apiKey: key.apiKey })) {
    return NextResponse.json(
      { error: `AI provider unavailable. Add a ${model.provider} key in Settings → API keys or configure it in .env.`, code: "PROVIDER_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: authed.user.id }, select: { settings: true } });
    const settings = safeJson(user?.settings);
    const memoryEnabled = settings.memoryEnabled !== false;

    if (payload.projectId) {
      const proj = await prisma.project.findFirst({ where: { id: payload.projectId, userId: authed.user.id } });
      if (!proj) throw new ApiError(404, "Project not found.", "PROJECT_NOT_FOUND");
    }

    let conversation = payload.conversationId
      ? await prisma.conversation.findFirst({ where: { id: payload.conversationId, userId: authed.user.id } })
      : null;

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          userId: authed.user.id,
          projectId: payload.projectId || null,
          title: payload.content.slice(0, 48) || "New Chat",
          agentId: agent.id,
          model: model.id,
        },
      });
    } else if (conversation.title === "New Chat") {
      await prisma.conversation.update({ where: { id: conversation.id }, data: { title: payload.content.slice(0, 48) } });
    }

    const userMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: payload.content,
        attachments: payload.attachments?.length ? JSON.stringify(payload.attachments) : undefined,
      },
    });

    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: "",
        status: "streaming",
        provider: model.provider,
        model: model.id,
        agent: agent.id,
      },
    });

    const history = await buildHistory(conversation.id, userMessage.id);

    let memoryBlock = "";
    if (memoryEnabled) {
      const context = await memoryRetriever.getContextForAgent(authed.user.id, agent.id, {
        projectId: payload.projectId ?? undefined,
        conversationId: conversation.id,
        query: payload.content,
      });
      memoryBlock = context.memories
        .map((m, i) => `${i + 1}. (${m.type}) ${m.content}`)
        .join("\n");
    }

    const stream = buildStream({
      userId: authed.user.id,
      conversationId: conversation.id,
      assistantMessageId: assistantMessage.id,
      requestId: reqId,
      history: [...history, { role: "user", content: payload.content }],
      model,
      provider,
      apiKey: key.apiKey,
      agent,
      researchMode: planning.researchMode,
      memoryBlock,
      planningDelays: planning.rationale.length > 0,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Conversation-Id": conversation.id,
      },
    });
  } catch (err) {
    log.error("chat-route-error", { requestId: reqId, error: (err as Error).message });
    if (err instanceof ApiError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return NextResponse.json({ error: "AI provider unavailable.", code: "PROVIDER_UNAVAILABLE", retriable: true }, { status: 503 });
  }
}

interface BuildStreamOptions {
  userId: string;
  conversationId: string;
  assistantMessageId: string;
  requestId: string;
  history: ChatMessage[];
  model: ModelInfo;
  provider: ReturnType<typeof getProvider>;
  apiKey?: string;
  agent: ReturnType<typeof getAgent>;
  researchMode: boolean;
  memoryBlock: string;
  planningDelays: boolean;
}

function buildStream(opts: BuildStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let persistedAt = 0;
  let liveText = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const aborted = { flag: false };
      const send = (event: StreamEvent) => {
        if (aborted.flag) throw new Error("aborted");
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          aborted.flag = true;
        }
      };

      try {
        if (opts.planningDelays) {
          send(streamEvent("text_delta", { content: "", })); // warm the pipe
        }

        const gen = orchestrate({
          userId: opts.userId,
          conversationId: opts.conversationId,
          messageId: opts.assistantMessageId,
          prompt: "",
          history: opts.history,
          model: opts.model,
          provider: opts.provider,
          apiKey: opts.apiKey,
          agent: opts.agent,
          researchMode: opts.researchMode,
          memoryBlock: opts.memoryBlock,
          requestId: opts.requestId,
        });

        const iterator = gen[Symbol.asyncIterator]();
        let final: OrchestrationResult = { text: "", sources: [], toolCalls: [] };
        let step = await iterator.next();
        while (!step.done) {
          const event = step.value as StreamEvent;
          if (event.type === "text_delta") {
            liveText += event.content;
            if (liveText.length - persistedAt > 300) {
              await persist({ content: liveText, status: "streaming", done: false });
            }
          }
          send(event);
          step = await iterator.next();
        }
        final = step.value;

        await persist({ content: liveText, status: "complete", done: true });
        await finalizeAssistantMessage(opts, liveText, final);
      } catch (err) {
        if ((err as Error).message === "aborted") return;
        const friendly = friendlyError(err);
        log.error("chat-stream-error", { requestId: opts.requestId, error: (err as Error).message });
        await markError(opts.assistantMessageId, friendly);
        try {
          send(streamEvent("error", { code: "STREAM_ERROR", message: friendly, retriable: isRetriable(friendly) }));
        } catch {
          /* closed */
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
    cancel() {
      void persist({ content: null, status: "interrupted", done: true }).catch(() => {});
    },
  });

  async function persist(p: { content: string | null; status: string; done: boolean }) {
    if (p.content === null && !p.done) return;
    const now = Date.now();
    if (!p.done && now - persistedAt < 200) return;
    persistedAt = now;
    try {
      await prisma.message.update({
        where: { id: opts.assistantMessageId },
        data: {
          content: p.content === null ? undefined : p.content.trim() === "" ? undefined : p.content,
          status: p.status,
        },
      });
    } catch {
      /* non-blocking */
    }
  }

  async function markError(messageId: string, error: string) {
    try {
      await prisma.message.update({ where: { id: messageId }, data: { status: "error", error } });
    } catch {
      /* non-blocking */
    }
  }
}

async function finalizeAssistantMessage(opts: BuildStreamOptions, text: string, result: OrchestrationResult) {
  try {
    const sources = result.sources.map((s) => ({ ...s }));
    await prisma.message.update({
      where: { id: opts.assistantMessageId },
      data: {
        content: text,
        status: "complete",
        meta: JSON.stringify({
          sources,
          toolCalls: result.toolCalls,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        }),
      },
    });

    // Async memory extraction (non-blocking)
    if (opts.history.length > 2) {
      const recentMessages = opts.history.slice(-10);
      const extraction = memoryExtractor.extractFromConversation({
        conversationId: opts.conversationId,
        userId: opts.userId,
        messages: recentMessages.map((m) => ({ role: m.role, content: m.content })),
        projectId: undefined, // Would need to pass from opts
      });

      // Don't await - run in background
      extraction.catch((err: unknown) => {
        log.error("memory-extraction-background-failed", { error: (err as Error).message });
      });
    }
  } catch {
    /* non-blocking */
  }
}

async function buildHistory(conversationId: string, excludeMessageId: string): Promise<ChatMessage[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
  });
  return rows
    .filter((m) => m.id !== excludeMessageId && (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
    .slice(-40)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

async function resolveModel(userId: string, requested?: string | null): Promise<ModelInfo> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const settings = safeJson(user?.settings);
  const id = requested || (settings.defaultModel as string | undefined);
  if (id) {
    const model = lookupModel(id);
    if (model) return model;
  }
  const available = await getAvailableModels(userId);
  const first = available.find((m) => m.available);
  return first ?? MODEL_CATALOG[0];
}

function safeJson(json?: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : "Unknown error";
  if (/invalid api key|authentication/i.test(message)) return "AI provider unavailable. Please check your API key.";
  if (/not configured|not enabled|integration point/.test(message)) return message;
  if (/temporarily unavailable|network/i.test(message)) return "AI provider unavailable. Please try again shortly.";
  return "AI provider unavailable.";
}

function isRetriable(message: string): boolean {
  return !/api key|invalid|not enabled|integration point/.test(message);
}
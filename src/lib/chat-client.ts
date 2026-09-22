/**
 * Client streaming chat: POSTs to /api/chat and parses a JSON-lines stream.
 */

export interface ChatStreamEventBase {
  type: string;
  id: string;
}

export interface ChatTextDelta extends ChatStreamEventBase {
  type: "text_delta";
  content: string;
}
export interface ChatReasoningDelta extends ChatStreamEventBase {
  type: "reasoning_delta";
  content: string;
}
export interface ChatToolStart extends ChatStreamEventBase {
  type: "tool_start";
  tool: string;
  input?: Record<string, unknown>;
}
export interface ChatToolResult extends ChatStreamEventBase {
  type: "tool_result";
  tool: string;
  success: boolean;
  summary?: string;
}
export interface ChatSourceEvent extends ChatStreamEventBase {
  type: "source";
  source: { title: string; url: string; provider?: string; snippet?: string; relevance?: number };
}
export interface ChatUsageEvent extends ChatStreamEventBase {
  type: "usage";
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}
export interface ChatDoneEvent extends ChatStreamEventBase {
  type: "done";
  messageId: string;
  conversationId: string;
}
export interface ChatErrorEvent extends ChatStreamEventBase {
  type: "error";
  code: string;
  message: string;
  retriable?: boolean;
}

export type ChatStreamEvent =
  | ChatTextDelta
  | ChatReasoningDelta
  | ChatToolStart
  | ChatToolResult
  | ChatSourceEvent
  | ChatUsageEvent
  | ChatDoneEvent
  | ChatErrorEvent;

export interface ChatPostPayload {
  conversationId?: string | null;
  content: string;
  model?: string | null;
  agent?: string | null;
  projectId?: string | null;
  attachments?: { name: string; type: string; size?: number; dataUrl?: string }[];
}

export interface StreamHandle {
  abort(): void;
}

export async function postChat(payload: ChatPostPayload, onEvent: (ev: ChatStreamEvent) => void): Promise<StreamHandle> {
  const controller = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      onEvent({ id: crypto.randomUUID(), type: "error", code: "NETWORK", message: "Could not reach the AI service.", retriable: true });
      return;
    }

    if (!res.ok && !res.body) {
      let message = "AI provider unavailable.";
      try {
        const data = await res.json();
        message = (data as { error?: string; retriable?: boolean }).error ?? message;
      } catch {
        /* ignore */
      }
      onEvent({ id: crypto.randomUUID(), type: "error", code: "HTTP" + res.status, message, retriable: res.status === 503 });
      return;
    }
    if (!res.ok) {
      // Non-ok JSON error body.
      let message = "Request failed.";
      let retriable = false;
      try {
        const data = (await res.json()) as { error?: string; retriable?: boolean };
        message = data.error ?? message;
        retriable = data.retriable ?? false;
      } catch {
        /* ignore */
      }
      onEvent({ id: crypto.randomUUID(), type: "error", code: "HTTP" + res.status, message, retriable });
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf("\n");
        while (idx !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line) {
            try {
              const ev = JSON.parse(line) as ChatStreamEvent;
              onEvent(ev);
            } catch {
              /* skip malformed keep-alive lines */
            }
          }
          idx = buffer.indexOf("\n");
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      onEvent({ id: crypto.randomUUID(), type: "error", code: "STREAM", message: "The stream was interrupted.", retriable: true });
    }
  })();

  return { abort: () => controller.abort() };
}
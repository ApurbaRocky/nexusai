/**
 * Shared, provider-agnostic domain types.
 */

export type MessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export type { MessageRole as ChatRole };

export interface ChatToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
  /** When role === "tool", echoes the tool name for reference. */
  name?: string;
  /** URN of the tool call being resolved. */
  toolCallId?: string;
  /** Assistant tool calls to echo back to the provider (agentic loop). */
  toolCalls?: ChatToolCall[];
}

export interface ChatSource {
  id?: string;
  sourceId?: string;
  documentId?: string;
  title: string;
  url: string;
  provider?: string;
  publishedAt?: string;
  snippet?: string;
  relevance?: number;
  verified?: boolean;
  page?: number;
}

export interface AttachmentRef {
  name: string;
  type: string;
  size?: number;
  /** Server-side reference after upload. */
  url?: string;
  documentId?: string;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ToolInfo {
  name: string;
  description: string;
  riskLevel: RiskLevel;
}

export interface StreamEventMap {
  text_delta: { content: string };
  reasoning_delta: { content: string };
  tool_start: { tool: string; input?: Record<string, unknown> };
  tool_result: { tool: string; success: boolean; summary?: string; output?: unknown };
  source: { source: ChatSource };
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  done: { messageId: string; conversationId: string };
  error: { code: string; message: string; retriable?: boolean };
}

export type StreamEventName = keyof StreamEventMap;
export type StreamEvent = { id: string; type: StreamEventName } & {
  [K in StreamEventName]: { id: string; type: K } & StreamEventMap[K];
}[StreamEventName];

export const streamEvent = <K extends StreamEventName>(type: K, payload: StreamEventMap[K]): StreamEvent =>
  ({ id: crypto.randomUUID(), type, ...payload }) as StreamEvent;

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  agentId?: string | null;
  model?: string | null;
}

export interface MessageRecord {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  provider?: string | null;
  model?: string | null;
  agent?: string | null;
  status: string;
  error?: string | null;
  attachments?: AttachmentRef[] | null;
  sources?: ChatSource[];
  tokens?: { prompt?: number; completion?: number; total?: number };
}
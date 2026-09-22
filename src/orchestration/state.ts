/**
 * Phase 7 — Task/Node state machine.
 * Validated transitions only: invalid transitions throw, never silently mutate.
 */
import type { NodeStatus, TaskStatus } from "@/orchestration/types";

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  draft: ["planning", "cancelled", "blocked"],
  planning: ["ready", "failed", "cancelled", "blocked"],
  ready: ["running", "paused", "cancelled", "blocked"],
  running: ["waiting", "waiting_approval", "paused", "completed", "failed", "cancelled", "blocked"],
  waiting: ["running", "waiting_approval", "paused", "cancelled", "failed", "blocked"],
  waiting_approval: ["running", "waiting", "paused", "cancelled", "failed", "blocked"],
  paused: ["running", "cancelled", "blocked"],
  completed: ["ready"], // re-run / restart supported
  failed: ["ready", "running", "cancelled"], // retry
  cancelled: ["draft", "ready"], // restart
  blocked: ["ready", "cancelled"],
};

const NODE_TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  pending: ["ready", "blocked", "cancelled"],
  ready: ["running", "blocked", "cancelled"],
  running: ["waiting", "waiting_approval", "paused", "completed", "failed", "retrying", "cancelled", "blocked"],
  waiting: ["running", "blocked", "cancelled"],
  waiting_approval: ["running", "blocked", "cancelled"],
  paused: ["running", "cancelled", "blocked"],
  completed: [],
  failed: ["ready", "retrying", "cancelled"],
  cancelled: [],
  retrying: ["running", "failed", "cancelled", "blocked"],
  blocked: ["ready", "cancelled"],
};

export class InvalidTransitionError extends Error {
  constructor(kind: "task" | "node", from: string, to: string) {
    super(`Invalid ${kind} transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function nextTaskStatus(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (from === to) return to;
  if (!TASK_TRANSITIONS[from]?.includes(to)) throw new InvalidTransitionError("task", from, to);
  return to;
}

export function nextNodeStatus(from: NodeStatus, to: NodeStatus): NodeStatus {
  if (from === to) return to;
  if (!NODE_TRANSITIONS[from]?.includes(to)) throw new InvalidTransitionError("node", from, to);
  return to;
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || (TASK_TRANSITIONS[from]?.includes(to) ?? false);
}

export function canTransitionNode(from: NodeStatus, to: NodeStatus): boolean {
  return from === to || (NODE_TRANSITIONS[from]?.includes(to) ?? false);
}

/** A task is considered "active" until a terminal state. */
export function isTaskTerminal(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}

export function isNodeTerminal(status: NodeStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}

/** Active node states that keep a task from being finished. */
export function nodeInFlight(status: NodeStatus): boolean {
  return status === "running" || status === "waiting" || status === "waiting_approval" || status === "retrying" || status === "ready";
}
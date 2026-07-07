/**
 * SSE event bus for automation task progress.
 *
 * In-process pub-sub: the engine emits events and SSE route handlers subscribe.
 * For multi-process deployments, replace with Redis pub-sub.
 */

import type { AutomationProgressEvent } from "@shared/types";

type Listener = (event: AutomationProgressEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeToTaskProgress(
  taskId: string,
  listener: Listener,
): () => void {
  if (!listeners.has(taskId)) {
    listeners.set(taskId, new Set());
  }
  listeners.get(taskId)!.add(listener);

  return () => {
    const set = listeners.get(taskId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) listeners.delete(taskId);
    }
  };
}

export function emitAutomationProgress(
  taskId: string,
  event: AutomationProgressEvent,
): void {
  const set = listeners.get(taskId);
  if (!set || set.size === 0) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      // Never crash the engine on a bad listener
    }
  }
}

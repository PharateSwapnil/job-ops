/**
 * Client API for the automation module.
 */

import type {
  AutomationEnqueueRequest,
  AutomationEnqueueResponse,
  AutomationPlatform,
  AutomationProgressEvent,
  AutomationQueueResponse,
  AutomationTaskDetail,
} from "@shared/types";
import { fetchApi } from "./core";
import { getCachedAuthHeader } from "./auth-session";

export async function getAutomationQueue(opts?: {
  statuses?: string[];
}): Promise<AutomationQueueResponse> {
  const params =
    opts?.statuses?.length ? `?status=${opts.statuses.join(",")}` : "";
  return fetchApi<AutomationQueueResponse>(`/automation/tasks${params}`);
}

export async function getAutomationTask(
  id: string,
): Promise<AutomationTaskDetail> {
  return fetchApi<AutomationTaskDetail>(`/automation/tasks/${id}`);
}

export async function enqueueAutomationTask(
  req: AutomationEnqueueRequest,
): Promise<AutomationEnqueueResponse> {
  return fetchApi<AutomationEnqueueResponse>("/automation/tasks", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function cancelAutomationTask(id: string): Promise<void> {
  await fetchApi(`/automation/tasks/${id}`, { method: "DELETE" });
}

export async function getConfiguredPlatforms(): Promise<AutomationPlatform[]> {
  const data = await fetchApi<{ platforms: AutomationPlatform[] }>(
    "/automation/credentials",
  );
  return data.platforms;
}

export async function upsertCredentials(
  platform: AutomationPlatform,
  username: string,
  password: string,
): Promise<void> {
  await fetchApi(`/automation/credentials/${platform}`, {
    method: "PUT",
    body: JSON.stringify({ username, password }),
  });
}

export async function deleteCredentials(
  platform: AutomationPlatform,
): Promise<void> {
  await fetchApi(`/automation/credentials/${platform}`, { method: "DELETE" });
}

/**
 * Subscribe to SSE progress events for a task.
 * Returns an unsubscribe function.
 */
export function streamTaskProgress(
  taskId: string,
  onEvent: (event: AutomationProgressEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const headers: Record<string, string> = {};
      const authHeader = getCachedAuthHeader();
      if (authHeader) headers["Authorization"] = authHeader;

      const response = await fetch(`/api/automation/tasks/${taskId}/progress`, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6));
              onEvent(parsed as AutomationProgressEvent);
            } catch {
              // Malformed SSE data — skip
            }
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted && onError) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return () => controller.abort();
}

/**
 * Automation repository — all DB queries for automation_tasks, automation_sessions,
 * automation_credentials, and automation_logs.
 */

import { randomUUID } from "node:crypto";
import { db } from "@server/db/index";
import {
  automationCredentials,
  automationLogs,
  automationSessions,
  automationTasks,
} from "@server/db/schema";
import type {
  AutomationPlatform,
  AutomationStatus,
  AutomationStep,
} from "@shared/types";
import { and, desc, eq, inArray } from "drizzle-orm";

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function upsertSession(params: {
  tenantId: string;
  userId: string | null;
  platform: AutomationPlatform;
  profileDir: string;
}): Promise<string> {
  const existing = await db
    .select({ id: automationSessions.id })
    .from(automationSessions)
    .where(
      and(
        eq(automationSessions.tenantId, params.tenantId),
        eq(automationSessions.platform, params.platform),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const id = existing[0].id;
    await db
      .update(automationSessions)
      .set({
        status: "active",
        lastUsedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(automationSessions.id, id));
    return id;
  }

  const id = randomUUID();
  await db.insert(automationSessions).values({
    id,
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    platform: params.platform,
    profileDir: params.profileDir,
    status: "active",
    lastUsedAt: new Date().toISOString(),
  });
  return id;
}

export async function getActiveSession(
  tenantId: string,
  platform: AutomationPlatform,
) {
  const rows = await db
    .select()
    .from(automationSessions)
    .where(
      and(
        eq(automationSessions.tenantId, tenantId),
        eq(automationSessions.platform, platform),
        eq(automationSessions.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function markSessionExpired(id: string): Promise<void> {
  await db
    .update(automationSessions)
    .set({ status: "expired", updatedAt: new Date().toISOString() })
    .where(eq(automationSessions.id, id));
}

// ─── Credentials ─────────────────────────────────────────────────────────────

export async function upsertCredentials(params: {
  tenantId: string;
  userId: string | null;
  platform: AutomationPlatform;
  username: string;
  encryptedPassword: string;
  iv: string;
  authTag: string;
}): Promise<void> {
  const existing = await db
    .select({ id: automationCredentials.id })
    .from(automationCredentials)
    .where(
      and(
        eq(automationCredentials.tenantId, params.tenantId),
        eq(automationCredentials.platform, params.platform),
      ),
    )
    .limit(1);

  const now = new Date().toISOString();
  if (existing.length > 0) {
    await db
      .update(automationCredentials)
      .set({
        username: params.username,
        encryptedPassword: params.encryptedPassword,
        iv: params.iv,
        authTag: params.authTag,
        updatedAt: now,
      })
      .where(eq(automationCredentials.id, existing[0].id));
  } else {
    await db.insert(automationCredentials).values({
      id: randomUUID(),
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      platform: params.platform,
      username: params.username,
      encryptedPassword: params.encryptedPassword,
      iv: params.iv,
      authTag: params.authTag,
    });
  }
}

export async function getCredentials(
  tenantId: string,
  platform: AutomationPlatform,
) {
  const rows = await db
    .select()
    .from(automationCredentials)
    .where(
      and(
        eq(automationCredentials.tenantId, tenantId),
        eq(automationCredentials.platform, platform),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteCredentials(
  tenantId: string,
  platform: AutomationPlatform,
): Promise<void> {
  await db
    .delete(automationCredentials)
    .where(
      and(
        eq(automationCredentials.tenantId, tenantId),
        eq(automationCredentials.platform, platform),
      ),
    );
}

export async function listConfiguredPlatforms(
  tenantId: string,
): Promise<AutomationPlatform[]> {
  const rows = await db
    .select({ platform: automationCredentials.platform })
    .from(automationCredentials)
    .where(eq(automationCredentials.tenantId, tenantId));
  return rows.map((r) => r.platform);
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function createTask(params: {
  tenantId: string;
  userId: string | null;
  jobId: string;
  platform: AutomationPlatform;
  jobUrl: string;
  jobTitle: string;
  employer: string;
  resumeDocumentId?: string;
  coverLetter?: string;
  maxRetries?: number;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(automationTasks).values({
    id,
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    jobId: params.jobId,
    platform: params.platform,
    jobUrl: params.jobUrl,
    jobTitle: params.jobTitle,
    employer: params.employer,
    resumeDocumentId: params.resumeDocumentId ?? null,
    coverLetter: params.coverLetter ?? null,
    status: "queued",
    stepProgress: 0,
    retryCount: 0,
    maxRetries: params.maxRetries ?? 3,
  });
  return id;
}

export async function getTask(id: string) {
  const rows = await db
    .select()
    .from(automationTasks)
    .where(eq(automationTasks.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getTasksByTenant(
  tenantId: string,
  statuses?: AutomationStatus[],
) {
  const conditions = [eq(automationTasks.tenantId, tenantId)];
  if (statuses && statuses.length > 0) {
    conditions.push(inArray(automationTasks.status, statuses));
  }
  return db
    .select()
    .from(automationTasks)
    .where(and(...conditions))
    .orderBy(desc(automationTasks.enqueuedAt));
}

export async function getNextQueuedTask(tenantId: string) {
  const rows = await db
    .select()
    .from(automationTasks)
    .where(
      and(
        eq(automationTasks.tenantId, tenantId),
        eq(automationTasks.status, "queued"),
      ),
    )
    .orderBy(automationTasks.enqueuedAt)
    .limit(1);
  return rows[0] ?? null;
}

export async function updateTaskStatus(
  id: string,
  status: AutomationStatus,
  extra?: Partial<{
    currentStep: AutomationStep | null;
    stepProgress: number;
    screenshotPath: string | null;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    retryCount: number;
  }>,
): Promise<void> {
  await db
    .update(automationTasks)
    .set({
      status,
      updatedAt: new Date().toISOString(),
      ...(extra ?? {}),
    })
    .where(eq(automationTasks.id, id));
}

export async function updateTaskStep(
  id: string,
  step: AutomationStep,
  progress: number,
): Promise<void> {
  await db
    .update(automationTasks)
    .set({
      currentStep: step,
      stepProgress: progress,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(automationTasks.id, id));
}

export async function cancelTask(id: string): Promise<void> {
  await db
    .update(automationTasks)
    .set({
      status: "cancelled",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(automationTasks.id, id));
}

export async function getQueuePosition(
  tenantId: string,
  taskId: string,
): Promise<number> {
  const queued = await db
    .select({ id: automationTasks.id })
    .from(automationTasks)
    .where(
      and(
        eq(automationTasks.tenantId, tenantId),
        eq(automationTasks.status, "queued"),
      ),
    )
    .orderBy(automationTasks.enqueuedAt);

  const idx = queued.findIndex((t) => t.id === taskId);
  return idx === -1 ? 0 : idx + 1;
}

// ─── Logs ────────────────────────────────────────────────────────────────────

export async function appendLog(params: {
  taskId: string;
  tenantId: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: unknown;
}): Promise<void> {
  await db.insert(automationLogs).values({
    id: randomUUID(),
    taskId: params.taskId,
    tenantId: params.tenantId,
    level: params.level,
    message: params.message,
    meta: params.meta !== undefined ? JSON.stringify(params.meta) : null,
  });
}

export async function getTaskLogs(taskId: string) {
  return db
    .select()
    .from(automationLogs)
    .where(eq(automationLogs.taskId, taskId))
    .orderBy(automationLogs.createdAt);
}

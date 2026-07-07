/**
 * Automation API routes.
 *
 * Mounts at /api/automation
 *
 * Credentials:
 *   PUT  /automation/credentials/:platform       — upsert credentials
 *   DELETE /automation/credentials/:platform     — delete credentials
 *   GET  /automation/credentials                 — list configured platforms
 *
 * Tasks / queue:
 *   POST /automation/tasks                       — enqueue a task
 *   GET  /automation/tasks                       — list tasks
 *   GET  /automation/tasks/:id                   — task detail + logs
 *   DELETE /automation/tasks/:id                 — cancel task
 *   GET  /automation/tasks/:id/progress          — SSE stream
 *   GET  /automation/tasks/:id/screenshot        — latest screenshot
 *
 * Platforms:
 *   GET  /automation/platforms                   — platform capabilities
 */

import { badRequest, notFound, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { getTenantId, getUserId } from "@infra/request-context";
import { setupSse, startSseHeartbeat, writeSseData } from "@infra/sse";
import { startAutomationWorker } from "@server/automation/queue/engine";
import { subscribeToTaskProgress } from "@server/automation/queue/events";
import * as automationRepo from "@server/automation/repositories/automation";
import {
  encryptPassword,
} from "@server/automation/services/credentials";
import * as jobsRepo from "@server/repositories/jobs";
import { DEFAULT_TENANT_ID } from "@server/tenancy/constants";
import {
  AUTOMATION_PLATFORM_CAPABILITIES,
  AUTOMATION_PLATFORM_VALUES,
} from "@shared/types";
import type { Request, Response } from "express";
import { Router } from "express";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";

export const automationRouter = Router();

// ─── Schema ──────────────────────────────────────────────────────────────────

const platformSchema = z.enum(AUTOMATION_PLATFORM_VALUES);

const upsertCredentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const enqueueTaskSchema = z.object({
  jobId: z.string().min(1),
  platform: platformSchema,
  resumeDocumentId: z.string().optional(),
  generateCoverLetter: z.boolean().optional().default(false),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function currentTenantId(): string {
  return getTenantId() ?? DEFAULT_TENANT_ID;
}

function currentUserId(): string | null {
  return getUserId() ?? null;
}

// ─── Credentials routes ───────────────────────────────────────────────────────

automationRouter.get("/credentials", async (req: Request, res: Response) => {
  try {
    const tenantId = currentTenantId();
    const platforms = await automationRepo.listConfiguredPlatforms(tenantId);
    ok(res, { platforms });
  } catch (err) {
    fail(res, toAppError(err));
  }
});

automationRouter.put(
  "/credentials/:platform",
  async (req: Request, res: Response) => {
    try {
      const platform = platformSchema.parse(req.params.platform);
      const body = upsertCredentialsSchema.parse(req.body);
      const tenantId = currentTenantId();
      const userId = currentUserId();

      const encrypted = encryptPassword(body.password);
      await automationRepo.upsertCredentials({
        tenantId,
        userId,
        platform,
        username: body.username,
        ...encrypted,
      });

      ok(res, { platform, username: body.username });
    } catch (err) {
      fail(res, toAppError(err));
    }
  },
);

automationRouter.delete(
  "/credentials/:platform",
  async (req: Request, res: Response) => {
    try {
      const platform = platformSchema.parse(req.params.platform);
      const tenantId = currentTenantId();
      await automationRepo.deleteCredentials(tenantId, platform);
      ok(res, { deleted: true });
    } catch (err) {
      fail(res, toAppError(err));
    }
  },
);

// ─── Platform info ────────────────────────────────────────────────────────────

automationRouter.get("/platforms", (_req: Request, res: Response) => {
  ok(res, { platforms: Object.values(AUTOMATION_PLATFORM_CAPABILITIES) });
});

// ─── Task routes ──────────────────────────────────────────────────────────────

automationRouter.get("/tasks", async (req: Request, res: Response) => {
  try {
    const tenantId = currentTenantId();
    const statusFilter = req.query.status
      ? String(req.query.status).split(",")
      : undefined;

    const tasks = await automationRepo.getTasksByTenant(
      tenantId,
      statusFilter as never,
    );

    const counts = tasks.reduce(
      (acc, t) => {
        acc[t.status as string] = (acc[t.status as string] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    ok(res, {
      tasks: tasks.map((t) => ({
        id: t.id,
        jobId: t.jobId,
        platform: t.platform,
        jobTitle: t.jobTitle,
        employer: t.employer,
        status: t.status,
        currentStep: t.currentStep,
        stepProgress: t.stepProgress,
        errorMessage: t.errorMessage,
        retryCount: t.retryCount,
        enqueuedAt: t.enqueuedAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
      })),
      total: tasks.length,
      running: counts["running"] ?? 0,
      queued: counts["queued"] ?? 0,
      failed: counts["failed"] ?? 0,
      completed: counts["completed"] ?? 0,
    });
  } catch (err) {
    fail(res, toAppError(err));
  }
});

automationRouter.post("/tasks", async (req: Request, res: Response) => {
  try {
    const body = enqueueTaskSchema.parse(req.body);
    const tenantId = currentTenantId();
    const userId = currentUserId();

    // Verify the job exists
    const job = await jobsRepo.getJobById(body.jobId);
    if (!job) {
      return fail(res, notFound(`Job ${body.jobId} not found`));
    }

    // Verify credentials exist for platform
    const creds = await automationRepo.getCredentials(tenantId, body.platform);
    if (!creds) {
      return fail(
        res,
        badRequest(
          `No credentials configured for ${body.platform}. ` +
            "Add credentials via PUT /api/automation/credentials/:platform first.",
        ),
      );
    }

    const taskId = await automationRepo.createTask({
      tenantId,
      userId,
      jobId: body.jobId,
      platform: body.platform,
      jobUrl: job.jobUrl,
      jobTitle: job.title,
      employer: job.employer,
      resumeDocumentId: body.resumeDocumentId,
      coverLetter: body.generateCoverLetter ? "generate" : undefined,
    });

    const position = await automationRepo.getQueuePosition(tenantId, taskId);

    // Ensure worker is running
    startAutomationWorker(tenantId);

    ok(res, {
      taskId,
      jobId: body.jobId,
      platform: body.platform,
      status: "queued",
      position,
    });
  } catch (err) {
    fail(res, toAppError(err));
  }
});

automationRouter.get("/tasks/:id", async (req: Request, res: Response) => {
  try {
    const task = await automationRepo.getTask(req.params.id);
    if (!task) return fail(res, notFound("Automation task not found"));

    const logs = await automationRepo.getTaskLogs(task.id);
    ok(res, { ...task, logs });
  } catch (err) {
    fail(res, toAppError(err));
  }
});

automationRouter.delete("/tasks/:id", async (req: Request, res: Response) => {
  try {
    const task = await automationRepo.getTask(req.params.id);
    if (!task) return fail(res, notFound("Automation task not found"));

    if (task.status === "running") {
      return fail(
        res,
        badRequest("Cannot cancel a running task — wait for it to complete or fail"),
      );
    }

    await automationRepo.cancelTask(task.id);
    ok(res, { cancelled: true, taskId: task.id });
  } catch (err) {
    fail(res, toAppError(err));
  }
});

// ─── SSE progress stream ──────────────────────────────────────────────────────

automationRouter.get(
  "/tasks/:id/progress",
  async (req: Request, res: Response) => {
    const taskId = req.params.id;

    const task = await automationRepo.getTask(taskId).catch(() => null);
    if (!task) {
      res.status(404).json({ ok: false, error: { message: "Task not found" } });
      return;
    }

    setupSse(res, { disableBuffering: true, flushHeaders: true });
    const stopHeartbeat = startSseHeartbeat(res, 15_000);

    // Send current state immediately
    writeSseData(res, {
      type: "progress",
      taskId,
      status: task.status,
      currentStep: task.currentStep,
      stepProgress: task.stepProgress,
      errorMessage: task.errorMessage,
      timestamp: new Date().toISOString(),
    });

    const unsubscribe = subscribeToTaskProgress(taskId, (event) => {
      writeSseData(res, event);
    });

    req.on("close", () => {
      stopHeartbeat();
      unsubscribe();
    });
  },
);

// ─── Screenshot endpoint ──────────────────────────────────────────────────────

automationRouter.get(
  "/tasks/:id/screenshot",
  async (req: Request, res: Response) => {
    try {
      const task = await automationRepo.getTask(req.params.id);
      if (!task || !task.screenshotPath) {
        return fail(res, notFound("No screenshot available"));
      }
      if (!existsSync(task.screenshotPath)) {
        return fail(res, notFound("Screenshot file not found"));
      }
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      const buf = await readFile(task.screenshotPath);
      res.end(buf);
    } catch (err) {
      fail(res, toAppError(err));
    }
  },
);

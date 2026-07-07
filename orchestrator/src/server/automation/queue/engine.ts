/**
 * Automation engine.
 *
 * Singleton worker that picks queued tasks one at a time,
 * drives the platform adapter through the full apply workflow,
 * and emits SSE progress events.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { getDataDir } from "@server/config/dataDir";
import * as jobsRepo from "@server/repositories/jobs";
import type { AutomationPlatform, AutomationStep } from "@shared/types";
import { browserEngine, resolveProfileDir, resolveScreenshotsDir } from "../browser/engine";
import type { ApplicationResult, StepReporter } from "../browser/types";
import { createAdapter } from "../platforms/registry";
import * as automationRepo from "../repositories/automation";
import { generateAiAnswers, generateCoverLetter } from "../services/ai-answers";
import { decryptPassword } from "../services/credentials";
import { emitAutomationProgress } from "./events";

const POLL_INTERVAL_MS = 3_000;
const MAX_CONCURRENT = 1;

let runningCount = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;

// ─── StepReporter factory ────────────────────────────────────────────────────

function buildReporter(
  taskId: string,
  tenantId: string,
  platform: string,
  screenshotsDir: string,
  getPage: () => import("playwright").Page | null,
): StepReporter {
  return {
    async report(step: AutomationStep, progress: number, message?: string): Promise<void> {
      await automationRepo.updateTaskStep(taskId, step, progress);
      emitAutomationProgress(taskId, {
        type: "step_change",
        taskId,
        status: "running",
        currentStep: step,
        stepProgress: progress,
        message,
        timestamp: new Date().toISOString(),
      });
      logger.info(`[automation][${platform}] step=${step} progress=${progress}`, { taskId, message });
    },

    async screenshot(label: string): Promise<string | null> {
      const page = getPage();
      if (!page) return null;
      try {
        const filename = `${taskId}-${label}-${Date.now()}.png`;
        const path = join(screenshotsDir, filename);
        await page.screenshot({ path, fullPage: false });
        await automationRepo.updateTaskStatus(taskId, "running", { screenshotPath: path });
        emitAutomationProgress(taskId, {
          type: "screenshot",
          taskId,
          status: "running",
          currentStep: null,
          stepProgress: 0,
          screenshotUrl: `/api/automation/tasks/${taskId}/screenshot`,
          timestamp: new Date().toISOString(),
        });
        return path;
      } catch {
        return null;
      }
    },

    async log(level: "info" | "warn" | "error", message: string, meta?: unknown): Promise<void> {
      await automationRepo.appendLog({ taskId, tenantId, level, message, meta });
      logger[level]?.(`[automation][${platform}] ${message}`, { taskId });
    },
  };
}

// ─── Task processor ──────────────────────────────────────────────────────────

async function processTask(taskId: string): Promise<void> {
  const task = await automationRepo.getTask(taskId);
  if (!task) return;

  const now = new Date().toISOString();
  await automationRepo.updateTaskStatus(taskId, "running", {
    startedAt: now,
    currentStep: "login",
    stepProgress: 0,
  });

  emitAutomationProgress(taskId, {
    type: "progress",
    taskId,
    status: "running",
    currentStep: "login",
    stepProgress: 0,
    timestamp: now,
  });

  const screenshotsDir = resolveScreenshotsDir(task.tenantId);
  const profileDir = resolveProfileDir(task.tenantId, task.platform);
  let currentPage: import("playwright").Page | null = null;
  let result: ApplicationResult = { success: false, errorMessage: "Unknown error" };

  try {
    // Run within tenant context so jobsRepo scope filters work
    await runWithRequestContext(
      {
        requestId: `automation-${taskId}`,
        tenantId: task.tenantId,
        userId: task.userId ?? undefined,
      },
      async () => {
        const ctx = await browserEngine.getContext(profileDir);
        const adapter = createAdapter(task.platform as AutomationPlatform);
        adapter.injectContext(ctx);

        currentPage = ctx.pages()[0] ?? await ctx.newPage();
        const reporter = buildReporter(taskId, task.tenantId, task.platform, screenshotsDir, () => currentPage);

        // 1. Credentials + login
        const creds = await automationRepo.getCredentials(task.tenantId, task.platform as AutomationPlatform);
        if (creds) {
          const password = decryptPassword({
            encryptedPassword: creds.encryptedPassword,
            iv: creds.iv,
            authTag: creds.authTag,
          });
          await reporter.report("login", 0, `Authenticating on ${task.platform}`);
          await adapter.login(creds.username, password, reporter);
        }

        // 2. Fetch job description for AI context
        const jobRecord = await jobsRepo.getJobById(task.jobId).catch(() => null);
        const jobDescription = jobRecord?.jobDescription ?? null;

        // 3. Resolve resume PDF path
        let resumePath: string | null = null;
        if (task.resumeDocumentId) {
          const candidatePath = join(getDataDir(), "resumes", `${task.resumeDocumentId}.pdf`);
          if (existsSync(candidatePath)) resumePath = candidatePath;
        }
        // Fall back to default tenant resume
        if (!resumePath) {
          const defaultPath = join(getDataDir(), "pdfs", "resume.pdf");
          if (existsSync(defaultPath)) resumePath = defaultPath;
        }

        // 4. Cover letter
        let coverLetter: string | null = task.coverLetter ?? null;
        if (coverLetter === "generate") {
          await reporter.report("fill_form", 5, "Generating cover letter");
          coverLetter = await generateCoverLetter({
            jobTitle: task.jobTitle,
            employer: task.employer,
            jobDescription,
          });
        }

        // 5. AI Q&A answers (populated dynamically when form questions are encountered)
        await reporter.report("answer_questions", 5, "Preparing AI context");
        const aiAnswers = await generateAiAnswers({
          jobTitle: task.jobTitle,
          employer: task.employer,
          jobDescription,
          questions: [],
        });

        // 6. Extract job detail
        await reporter.report("extract", 10, "Extracting job details");
        const extracted = await adapter.extractJob(task.jobUrl, reporter);

        // 7. Full apply workflow
        result = await adapter.apply(
          {
            jobUrl: task.jobUrl,
            jobTitle: task.jobTitle,
            employer: task.employer,
            jobDescription: extracted.jobDescription ?? jobDescription,
            resumePath,
            coverLetter,
            aiAnswers,
          },
          reporter,
        );

        // 8. Mark job as applied on success
        if (result.success) {
          await jobsRepo.updateJob(task.jobId, {
            status: "applied",
            appliedAt: new Date().toISOString(),
          }).catch(() => null);
        }
      },
    );

    await automationRepo.updateTaskStatus(taskId, result.success ? "completed" : "failed", {
      completedAt: new Date().toISOString(),
      errorMessage: result.errorMessage ?? null,
      stepProgress: 100,
    });

    emitAutomationProgress(taskId, {
      type: result.success ? "completed" : "error",
      taskId,
      status: result.success ? "completed" : "failed",
      currentStep: "verify",
      stepProgress: 100,
      errorMessage: result.errorMessage ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[automation] Task error", { taskId, error: message });

    const latestTask = await automationRepo.getTask(taskId);
    const retryCount = (latestTask?.retryCount ?? 0) + 1;
    const maxRetries = latestTask?.maxRetries ?? 3;
    const nextStatus = retryCount < maxRetries ? "queued" : "failed";

    await automationRepo.updateTaskStatus(taskId, nextStatus, {
      completedAt: nextStatus === "failed" ? new Date().toISOString() : null,
      errorMessage: `${nextStatus === "queued" ? `Retry ${retryCount}/${maxRetries}: ` : ""}${message}`,
      retryCount,
    });

    emitAutomationProgress(taskId, {
      type: "error",
      taskId,
      status: nextStatus,
      currentStep: null,
      stepProgress: 0,
      errorMessage: message,
      timestamp: new Date().toISOString(),
    });
  } finally {
    runningCount--;
  }
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function poll(tenantId: string): Promise<void> {
  if (isShuttingDown || runningCount >= MAX_CONCURRENT) return;
  const next = await automationRepo.getNextQueuedTask(tenantId).catch(() => null);
  if (!next) return;
  runningCount++;
  processTask(next.id).catch((err) => {
    logger.error("[automation] Unhandled processTask rejection", { error: err });
    runningCount = Math.max(0, runningCount - 1);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startAutomationWorker(tenantId: string): void {
  if (pollTimer) return;
  logger.info("[automation] Worker started", { tenantId });
  const tick = async () => {
    await poll(tenantId).catch(() => null);
    if (!isShuttingDown) {
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };
  pollTimer = setTimeout(tick, 500);
}

export async function stopAutomationWorker(): Promise<void> {
  isShuttingDown = true;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  await browserEngine.shutdown();
  logger.info("[automation] Worker stopped");
}

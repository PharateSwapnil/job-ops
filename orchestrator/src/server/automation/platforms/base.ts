/**
 * Base platform adapter.
 *
 * Provides shared screenshot, logging, and form-filling helpers.
 * Every concrete adapter extends this class.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@infra/logger";
import { getDataDir } from "@server/config/dataDir";
import type { AutomationPlatform } from "@shared/types";
import type { BrowserContext, Page } from "playwright";
import {
  humanClick,
  humanScroll,
  humanType,
  randomDelay,
  waitForNavigation,
  waitForVisible,
  withRetry,
} from "../browser/human";
import type {
  ApplicationResult,
  JobApplicationInput,
  PlatformAutomator,
  StepReporter,
} from "../browser/types";

export abstract class BasePlatformAdapter implements PlatformAutomator {
  abstract readonly platform: AutomationPlatform;
  abstract readonly label: string;

  protected context!: BrowserContext;
  protected page!: Page;

  /** Inject the browser context before running the workflow */
  injectContext(ctx: BrowserContext): void {
    this.context = ctx;
  }

  /** Open or reuse a page inside the context */
  protected async ensurePage(): Promise<Page> {
    const pages = this.context.pages();
    if (pages.length > 0) {
      this.page = pages[0];
    } else {
      this.page = await this.context.newPage();
    }
    return this.page;
  }

  // ─── Abstract contract ─────────────────────────────────────────────────────

  abstract login(
    username: string,
    password: string,
    reporter: StepReporter,
  ): Promise<void>;

  abstract searchJobs(
    keywords: string,
    location: string,
    reporter: StepReporter,
  ): Promise<string[]>;

  abstract extractJob(
    jobUrl: string,
    reporter: StepReporter,
  ): Promise<Partial<JobApplicationInput>>;

  abstract navigateToApply(
    jobUrl: string,
    reporter: StepReporter,
  ): Promise<void>;

  abstract uploadResume(
    resumePath: string,
    reporter: StepReporter,
  ): Promise<void>;

  abstract fillForm(
    input: JobApplicationInput,
    reporter: StepReporter,
  ): Promise<void>;

  abstract answerQuestions(
    aiAnswers: Map<string, string>,
    reporter: StepReporter,
  ): Promise<void>;

  abstract submit(reporter: StepReporter): Promise<void>;

  abstract verify(reporter: StepReporter): Promise<ApplicationResult>;

  abstract logout(reporter: StepReporter): Promise<void>;

  // ─── Default apply orchestration ───────────────────────────────────────────

  async apply(
    input: JobApplicationInput,
    reporter: StepReporter,
  ): Promise<ApplicationResult> {
    await reporter.report(
      "navigate",
      10,
      `Navigating to ${this.label} application`,
    );
    await this.navigateToApply(input.jobUrl, reporter);

    if (input.resumePath) {
      await reporter.report("upload_resume", 30, "Uploading resume");
      await this.uploadResume(input.resumePath, reporter);
    }

    await reporter.report("fill_form", 50, "Filling in application form");
    await this.fillForm(input, reporter);

    if (input.aiAnswers.size > 0) {
      await reporter.report(
        "answer_questions",
        70,
        "Answering screening questions",
      );
      await this.answerQuestions(input.aiAnswers, reporter);
    }

    await reporter.report("submit", 85, "Submitting application");
    await this.submit(reporter);

    await reporter.report("verify", 95, "Verifying submission");
    return this.verify(reporter);
  }

  // ─── Shared helpers ────────────────────────────────────────────────────────

  protected async screenshotPage(
    label: string,
    tenantId: string,
    taskId: string,
  ): Promise<string | null> {
    try {
      const dir = join(getDataDir(), "automation", "screenshots", tenantId);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const filename = `${taskId}-${label}-${Date.now()}.png`;
      const path = join(dir, filename);
      await this.page.screenshot({ path, fullPage: false });
      return path;
    } catch (err) {
      logger.warn("Screenshot failed", { label, error: err });
      return null;
    }
  }

  protected async fillTextField(
    selector: string,
    value: string,
    opts: { clear?: boolean; timeout?: number } = {},
  ): Promise<boolean> {
    try {
      const locator = this.page.locator(selector).first();
      const visible = await waitForVisible(locator, opts.timeout ?? 5_000);
      if (!visible) return false;
      await humanType(locator, value, { clear: opts.clear ?? true });
      return true;
    } catch {
      return false;
    }
  }

  protected async clickElement(
    selector: string,
    opts: { timeout?: number } = {},
  ): Promise<boolean> {
    try {
      const locator = this.page.locator(selector).first();
      const visible = await waitForVisible(locator, opts.timeout ?? 5_000);
      if (!visible) return false;
      await humanClick(locator);
      return true;
    } catch {
      return false;
    }
  }

  protected async selectOption(
    selector: string,
    value: string,
  ): Promise<boolean> {
    try {
      const locator = this.page.locator(selector).first();
      const visible = await waitForVisible(locator, 5_000);
      if (!visible) return false;
      await locator.selectOption(value);
      await randomDelay(200, 500);
      return true;
    } catch {
      return false;
    }
  }

  protected async uploadFile(
    selector: string,
    filePath: string,
  ): Promise<boolean> {
    try {
      const input = this.page.locator(selector).first();
      await input.setInputFiles(filePath);
      await randomDelay(1_000, 2_000);
      return true;
    } catch {
      return false;
    }
  }

  protected async isLoggedIn(indicators: string[]): Promise<boolean> {
    for (const indicator of indicators) {
      try {
        const count = await this.page.locator(indicator).count();
        if (count > 0) return true;
      } catch {
        // continue
      }
    }
    return false;
  }

  // Re-export helpers for subclasses
  protected readonly humanType = humanType;
  protected readonly humanClick = humanClick;
  protected readonly humanScroll = humanScroll;
  protected readonly randomDelay = randomDelay;
  protected readonly waitForNavigation = waitForNavigation;
  protected readonly waitForVisible = waitForVisible;
  protected readonly withRetry = withRetry;
}

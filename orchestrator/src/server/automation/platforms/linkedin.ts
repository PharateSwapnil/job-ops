/**
 * LinkedIn platform adapter.
 *
 * Supports LinkedIn Easy Apply multi-step forms.
 * Session is persisted via the browser profile directory.
 */

import { logger } from "@infra/logger";
import type { ApplicationResult, JobApplicationInput, StepReporter } from "../browser/types";
import { BasePlatformAdapter } from "./base";

const LINKEDIN_BASE = "https://www.linkedin.com";

export class LinkedInAdapter extends BasePlatformAdapter {
  readonly platform = "linkedin" as const;
  readonly label = "LinkedIn";

  async login(
    username: string,
    password: string,
    reporter: StepReporter,
  ): Promise<void> {
    await this.ensurePage();
    await reporter.report("login", 5, "Checking LinkedIn session");

    // Check if already logged in
    await this.page.goto(`${LINKEDIN_BASE}/feed/`, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_000, 2_500);

    const alreadyLoggedIn = await this.isLoggedIn([
      "[data-test-id='nav-settings']",
      ".feed-identity-module",
      ".global-nav__me-photo",
    ]);

    if (alreadyLoggedIn) {
      await reporter.log("info", "LinkedIn session reused — skipping login");
      return;
    }

    await reporter.report("login", 15, "Logging into LinkedIn");
    await this.page.goto(`${LINKEDIN_BASE}/login`, { waitUntil: "domcontentloaded" });
    await this.randomDelay(800, 1_500);

    await this.fillTextField("#username", username);
    await this.randomDelay(400, 800);
    await this.fillTextField("#password", password);
    await this.randomDelay(300, 700);
    await this.clickElement("[type='submit']");

    await this.page.waitForLoadState("domcontentloaded");
    await this.randomDelay(2_000, 3_500);

    // Handle CAPTCHA / verification checkpoint
    if (this.page.url().includes("/checkpoint/")) {
      await reporter.screenshot("linkedin-checkpoint");
      await reporter.log("warn", "LinkedIn checkpoint detected — manual intervention may be required");
      // Give extra time for the user to handle it
      await this.randomDelay(5_000, 8_000);
    }

    const loggedIn = await this.isLoggedIn([".feed-identity-module", ".global-nav__me-photo"]);
    if (!loggedIn) {
      throw new Error("LinkedIn login failed — check credentials or resolve CAPTCHA");
    }

    await reporter.log("info", "LinkedIn login successful");
  }

  async searchJobs(
    keywords: string,
    location: string,
    reporter: StepReporter,
  ): Promise<string[]> {
    await reporter.report("search", 20, "Searching LinkedIn jobs");
    const encoded = encodeURIComponent(keywords);
    const loc = encodeURIComponent(location);
    await this.page.goto(
      `${LINKEDIN_BASE}/jobs/search/?keywords=${encoded}&location=${loc}&f_AL=true`,
      { waitUntil: "domcontentloaded" },
    );
    await this.randomDelay(2_000, 3_000);
    await this.humanScroll(this.page, "down", 800);

    const links = await this.page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a.job-card-list__title"),
      );
      return anchors.map((a) => a.href).filter(Boolean).slice(0, 20);
    });

    await reporter.log("info", `Found ${links.length} LinkedIn jobs`);
    return links;
  }

  async extractJob(
    jobUrl: string,
    reporter: StepReporter,
  ): Promise<Partial<JobApplicationInput>> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);

    const description = await this.page
      .locator(".jobs-description__content")
      .textContent()
      .catch(() => null);

    return { jobUrl, jobDescription: description };
  }

  async navigateToApply(jobUrl: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    if (!this.page.url().startsWith(jobUrl.split("?")[0])) {
      await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
      await this.randomDelay(1_500, 2_500);
    }

    // Click Easy Apply button
    const easyApplyClicked = await this.withRetry(
      async () => {
        const btn = this.page.locator(".jobs-apply-button--top-card").first();
        const visible = await this.waitForVisible(btn, 8_000);
        if (!visible) throw new Error("Easy Apply button not found");
        await this.humanClick(btn);
        return true;
      },
      { maxAttempts: 3, baseMs: 1_500, label: "LinkedIn Easy Apply" },
    );

    if (!easyApplyClicked) {
      throw new Error("Could not open LinkedIn Easy Apply form");
    }
    await this.randomDelay(1_000, 2_000);
  }

  async uploadResume(resumePath: string, reporter: StepReporter): Promise<void> {
    // Look for resume upload input inside the modal
    const uploaded = await this.uploadFile(
      "input[name='file'][type='file'], input[type='file'][accept*='pdf']",
      resumePath,
    );
    if (uploaded) {
      await this.randomDelay(1_500, 2_500);
      await reporter.log("info", "Resume uploaded to LinkedIn form");
    }
  }

  async fillForm(input: JobApplicationInput, reporter: StepReporter): Promise<void> {
    // LinkedIn Easy Apply is a multi-step modal; fill common fields on each page
    const MAX_STEPS = 10;
    for (let step = 0; step < MAX_STEPS; step++) {
      await this.randomDelay(800, 1_500);

      // Check for text inputs that look like standard fields
      const phoneInput = this.page.locator(
        "input[id*='phoneNumber'], input[aria-label*='phone' i]",
      ).first();
      if (await phoneInput.isVisible().catch(() => false)) {
        const val = await phoneInput.inputValue().catch(() => "");
        if (!val) await this.humanType(phoneInput, "+91 9999999999");
      }

      // "Next" button
      const nextBtn = this.page.locator(
        "button[aria-label='Continue to next step'], button[aria-label='Review your application']",
      ).first();
      if (await nextBtn.isVisible().catch(() => false)) {
        await this.humanClick(nextBtn);
        continue;
      }

      // Submit button — stop filling
      const submitBtn = this.page.locator(
        "button[aria-label='Submit application']",
      ).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        break;
      }

      break;
    }
  }

  async answerQuestions(
    aiAnswers: Map<string, string>,
    reporter: StepReporter,
  ): Promise<void> {
    // Collect visible text inputs / textareas in the modal
    const inputs = this.page.locator(
      ".jobs-easy-apply-form-section__grouping input[type='text'], " +
      ".jobs-easy-apply-form-section__grouping textarea",
    );
    const count = await inputs.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const label = await input
        .evaluate((el) => {
          const id = el.id;
          return id ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() ?? "" : "";
        })
        .catch(() => "");

      const answer = label ? (aiAnswers.get(label) ?? "") : "";
      if (answer) {
        await this.humanType(input, answer, { clear: true });
        await this.randomDelay(300, 700);
      }
    }
  }

  async submit(reporter: StepReporter): Promise<void> {
    await this.withRetry(
      async () => {
        const submitBtn = this.page.locator(
          "button[aria-label='Submit application']",
        ).first();
        const visible = await this.waitForVisible(submitBtn, 8_000);
        if (!visible) throw new Error("Submit button not found");
        await this.humanClick(submitBtn);
      },
      { maxAttempts: 2, baseMs: 1_000 },
    );
    await this.randomDelay(2_000, 3_500);
  }

  async verify(reporter: StepReporter): Promise<ApplicationResult> {
    await this.randomDelay(1_000, 2_000);
    const successLocator = this.page.locator(
      "[data-test-modal='easy-apply-success-modal'], .artdeco-modal .jobs-easy-apply-modal__success",
    ).first();
    const isSuccess = await this.waitForVisible(successLocator, 5_000);

    if (isSuccess) {
      await reporter.log("info", "LinkedIn Easy Apply submitted successfully");
      // Dismiss the modal
      await this.clickElement("[aria-label='Dismiss']").catch(() => null);
      return { success: true };
    }

    // Check for error messages
    const errorText = await this.page
      .locator(".artdeco-inline-feedback--error")
      .first()
      .textContent()
      .catch(() => null);

    return {
      success: false,
      errorMessage: errorText ?? "LinkedIn application could not be verified",
    };
  }

  async logout(reporter: StepReporter): Promise<void> {
    await this.page.goto(`${LINKEDIN_BASE}/m/logout/`, {
      waitUntil: "domcontentloaded",
    });
    await reporter.log("info", "LinkedIn session ended");
  }
}

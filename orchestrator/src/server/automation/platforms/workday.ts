/**
 * Workday ATS adapter.
 *
 * Workday career sites follow the pattern <company>.wd<N>.myworkdayjobs.com.
 * The flow: search → job detail → Apply → multi-step wizard.
 * This adapter handles the standard Workday wizard steps.
 */

import type {
  ApplicationResult,
  JobApplicationInput,
  StepReporter,
} from "../browser/types";
import { BasePlatformAdapter } from "./base";

export class WorkdayAdapter extends BasePlatformAdapter {
  readonly platform = "workday" as const;
  readonly label = "Workday";

  async login(
    username: string,
    password: string,
    reporter: StepReporter,
  ): Promise<void> {
    await this.ensurePage();
    await reporter.report("login", 5, "Checking Workday session");
    // Workday sessions are per company site; we attempt sign-in if sign-in form is visible
    const signInBtn = this.page
      .locator("button:has-text('Sign In'), a:has-text('Sign In')")
      .first();
    if (await signInBtn.isVisible().catch(() => false)) {
      await this.humanClick(signInBtn);
      await this.randomDelay(1_000, 2_000);
      await this.fillTextField("input[data-automation-id='email']", username);
      await this.randomDelay(400, 800);
      await this.fillTextField(
        "input[data-automation-id='password']",
        password,
      );
      await this.randomDelay(300, 600);
      await this.clickElement("button[data-automation-id='click_filter']");
      await this.page.waitForLoadState("domcontentloaded");
      await this.randomDelay(2_000, 3_500);
      await reporter.log("info", "Workday sign-in attempted");
    } else {
      await reporter.log(
        "info",
        "Workday — no sign-in prompt; proceeding as guest or existing session",
      );
    }
  }

  async searchJobs(
    _keywords: string,
    _location: string,
    reporter: StepReporter,
  ): Promise<string[]> {
    await reporter.log(
      "info",
      "Workday search requires company-specific URL — use direct job URLs",
    );
    return [];
  }

  async extractJob(
    jobUrl: string,
    reporter: StepReporter,
  ): Promise<Partial<JobApplicationInput>> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
    const desc = await this.page
      .locator("[data-automation-id='jobPostingDescription']")
      .first()
      .textContent()
      .catch(() => null);
    return { jobUrl, jobDescription: desc };
  }

  async navigateToApply(jobUrl: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
    await this.withRetry(
      async () => {
        const btn = this.page
          .locator("[data-automation-id='applyBtn'], button:has-text('Apply')")
          .first();
        const visible = await this.waitForVisible(btn, 8_000);
        if (!visible) throw new Error("Workday Apply button not found");
        await this.humanClick(btn);
      },
      { maxAttempts: 3, baseMs: 1_500 },
    );
    await this.randomDelay(2_000, 3_000);
  }

  async uploadResume(
    resumePath: string,
    reporter: StepReporter,
  ): Promise<void> {
    const uploaded = await this.uploadFile(
      "input[type='file'][data-automation-id*='resume'], input[type='file']",
      resumePath,
    );
    if (uploaded) {
      await reporter.log("info", "Resume uploaded to Workday");
      await this.randomDelay(2_000, 3_000); // Workday parses the resume
    }
  }

  async fillForm(
    input: JobApplicationInput,
    reporter: StepReporter,
  ): Promise<void> {
    // Workday wizard: step through pages clicking "Next" / "Save and Continue"
    const MAX_PAGES = 8;
    for (let pg = 0; pg < MAX_PAGES; pg++) {
      await this.randomDelay(800, 1_500);

      // Fill any visible text inputs
      const textInputs = this.page.locator(
        "input[data-automation-id*='text']:visible, input[type='text']:visible",
      );
      const cnt = await textInputs.count().catch(() => 0);
      for (let i = 0; i < cnt; i++) {
        const el = textInputs.nth(i);
        const val = await el.inputValue().catch(() => "");
        if (!val) {
          // Try to find its label
          const labelText = await el
            .evaluate((node) => {
              const id = (node as HTMLInputElement).id;
              return id
                ? (document
                    .querySelector(`label[for="${id}"]`)
                    ?.textContent?.trim() ?? "")
                : "";
            })
            .catch(() => "");
          if (labelText && input.aiAnswers.get(labelText)) {
            await this.humanType(el, input.aiAnswers.get(labelText)!, {
              clear: true,
            });
            await this.randomDelay(300, 600);
          }
        }
      }

      // "Save and Continue" / "Next"
      const nextBtn = this.page
        .locator(
          "[data-automation-id='bottom-navigation-next-btn'], button:has-text('Next')",
        )
        .first();
      if (await nextBtn.isVisible().catch(() => false)) {
        await this.humanClick(nextBtn);
        await this.randomDelay(1_500, 2_500);
        continue;
      }

      // Review page
      const reviewBtn = this.page
        .locator("[data-automation-id='bottom-navigation-review-btn']")
        .first();
      if (await reviewBtn.isVisible().catch(() => false)) {
        await this.humanClick(reviewBtn);
        await this.randomDelay(1_500, 2_500);
        continue;
      }

      break;
    }
  }

  async answerQuestions(
    aiAnswers: Map<string, string>,
    reporter: StepReporter,
  ): Promise<void> {
    // Already handled in fillForm's per-page loop
  }

  async submit(reporter: StepReporter): Promise<void> {
    await this.withRetry(
      async () => {
        const btn = this.page
          .locator(
            "[data-automation-id='bottom-navigation-submit-btn'], button:has-text('Submit')",
          )
          .first();
        const visible = await this.waitForVisible(btn, 8_000);
        if (!visible) throw new Error("Workday submit button not found");
        await this.humanClick(btn);
      },
      { maxAttempts: 2 },
    );
    await this.randomDelay(2_000, 3_500);
  }

  async verify(reporter: StepReporter): Promise<ApplicationResult> {
    await this.randomDelay(1_500, 2_500);
    const success = await this.page
      .locator(
        "[data-automation-id='thankYouBanner'], h1:has-text('Thank You')",
      )
      .first()
      .isVisible()
      .catch(() => false);
    return success
      ? { success: true }
      : { success: false, errorMessage: "Workday submission not confirmed" };
  }

  async logout(reporter: StepReporter): Promise<void> {
    await this.clickElement(
      "[data-automation-id='signOut'], a:has-text('Sign Out')",
    );
    await reporter.log("info", "Workday session ended");
  }
}

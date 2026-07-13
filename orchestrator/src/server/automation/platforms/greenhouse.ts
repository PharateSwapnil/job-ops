/**
 * Greenhouse ATS adapter.
 *
 * Greenhouse jobs are hosted at boards.greenhouse.io/<company>/jobs/<id>.
 * There is no site-level login — applications are typically anonymous.
 * We fill the standard Greenhouse form and submit.
 */

import type {
  ApplicationResult,
  JobApplicationInput,
  StepReporter,
} from "../browser/types";
import { BasePlatformAdapter } from "./base";

export class GreenhouseAdapter extends BasePlatformAdapter {
  readonly platform = "greenhouse" as const;
  readonly label = "Greenhouse";

  async login(
    _username: string,
    _password: string,
    reporter: StepReporter,
  ): Promise<void> {
    await reporter.log(
      "info",
      "Greenhouse requires no site login — proceeding anonymously",
    );
  }

  async searchJobs(
    _keywords: string,
    _location: string,
    reporter: StepReporter,
  ): Promise<string[]> {
    await reporter.log(
      "info",
      "Greenhouse search is not supported — provide direct job URLs",
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
      .locator("#content .job-post")
      .textContent()
      .catch(() => null);
    return { jobUrl, jobDescription: desc };
  }

  async navigateToApply(jobUrl: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_000, 2_000);
    // Greenhouse forms are inline — no navigation needed
  }

  async uploadResume(
    resumePath: string,
    reporter: StepReporter,
  ): Promise<void> {
    const uploaded = await this.uploadFile(
      "input[type='file'][id*='resume'], input[type='file'][name*='resume']",
      resumePath,
    );
    if (uploaded)
      await reporter.log("info", "Resume uploaded to Greenhouse form");
  }

  async fillForm(
    input: JobApplicationInput,
    reporter: StepReporter,
  ): Promise<void> {
    await this.fillTextField("#first_name", "");
    await this.fillTextField("#last_name", "");
    await this.fillTextField("#email", "");
    await this.fillTextField("#phone", "");
    if (input.coverLetter) {
      await this.fillTextField("textarea#cover_letter_text", input.coverLetter);
    }
  }

  async answerQuestions(
    aiAnswers: Map<string, string>,
    reporter: StepReporter,
  ): Promise<void> {
    const questions = this.page.locator(".custom-question");
    const count = await questions.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const q = questions.nth(i);
      const labelText = await q
        .locator("label")
        .first()
        .textContent()
        .catch(() => "");
      const answer = labelText?.trim()
        ? (aiAnswers.get(labelText.trim()) ?? "")
        : "";
      if (answer) {
        const input = q.locator("input[type='text'], textarea").first();
        if (await input.isVisible().catch(() => false)) {
          await this.humanType(input, answer, { clear: true });
          await this.randomDelay(300, 600);
        }
      }
    }
  }

  async submit(reporter: StepReporter): Promise<void> {
    await this.withRetry(
      async () => {
        const btn = this.page
          .locator("#submit_app, input[type='submit'][value*='Submit']")
          .first();
        const visible = await this.waitForVisible(btn, 8_000);
        if (!visible) throw new Error("Greenhouse submit not found");
        await this.humanClick(btn);
      },
      { maxAttempts: 2 },
    );
    await this.randomDelay(2_000, 3_500);
  }

  async verify(reporter: StepReporter): Promise<ApplicationResult> {
    await this.randomDelay(1_000, 2_000);
    const success = await this.page
      .locator("h2:has-text('Application Submitted'), .success-message")
      .first()
      .isVisible()
      .catch(() => false);
    return success
      ? { success: true }
      : { success: false, errorMessage: "Greenhouse submission not confirmed" };
  }

  async logout(reporter: StepReporter): Promise<void> {
    await reporter.log("info", "Greenhouse requires no logout");
  }
}

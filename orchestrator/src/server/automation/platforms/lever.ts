/**
 * Lever ATS adapter.
 *
 * Lever jobs are hosted at jobs.lever.co/<company>/<job-id>.
 * The application form is a single-page form with optional file upload.
 */

import type { ApplicationResult, JobApplicationInput, StepReporter } from "../browser/types";
import { BasePlatformAdapter } from "./base";

export class LeverAdapter extends BasePlatformAdapter {
  readonly platform = "lever" as const;
  readonly label = "Lever";

  async login(_username: string, _password: string, reporter: StepReporter): Promise<void> {
    await reporter.log("info", "Lever requires no site login — applying directly");
  }

  async searchJobs(_keywords: string, _location: string, reporter: StepReporter): Promise<string[]> {
    await reporter.log("info", "Lever search not supported — use direct job URLs");
    return [];
  }

  async extractJob(jobUrl: string, reporter: StepReporter): Promise<Partial<JobApplicationInput>> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
    const desc = await this.page.locator(".posting-page .section-wrapper").first().textContent().catch(() => null);
    return { jobUrl, jobDescription: desc };
  }

  async navigateToApply(jobUrl: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    const applyUrl = jobUrl.endsWith("/apply") ? jobUrl : `${jobUrl}/apply`;
    await this.page.goto(applyUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
  }

  async uploadResume(resumePath: string, reporter: StepReporter): Promise<void> {
    const uploaded = await this.uploadFile(
      "input[type='file'][name='resume']",
      resumePath,
    );
    if (uploaded) await reporter.log("info", "Resume uploaded to Lever");
  }

  async fillForm(input: JobApplicationInput, reporter: StepReporter): Promise<void> {
    await this.fillTextField("input[name='name']", "");
    await this.fillTextField("input[name='email']", "");
    await this.fillTextField("input[name='phone']", "");
    if (input.coverLetter) {
      await this.fillTextField("textarea[name='comments']", input.coverLetter);
    }
  }

  async answerQuestions(aiAnswers: Map<string, string>, reporter: StepReporter): Promise<void> {
    const cards = this.page.locator(".application-question");
    const count = await cards.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const label = await card.locator("label").first().textContent().catch(() => "");
      const trimmedLabel = label?.trim() ?? "";
      const answer = trimmedLabel ? (aiAnswers.get(trimmedLabel) ?? "") : "";
      if (!answer) continue;
      const input = card.locator("input[type='text'], textarea").first();
      if (await input.isVisible().catch(() => false)) {
        await this.humanType(input, answer, { clear: true });
        await this.randomDelay(300, 600);
      }
    }
  }

  async submit(reporter: StepReporter): Promise<void> {
    await this.withRetry(async () => {
      const btn = this.page.locator("button[type='submit']:has-text('Submit application')").first();
      const visible = await this.waitForVisible(btn, 8_000);
      if (!visible) throw new Error("Lever submit button not found");
      await this.humanClick(btn);
    }, { maxAttempts: 2 });
    await this.randomDelay(2_000, 3_500);
  }

  async verify(reporter: StepReporter): Promise<ApplicationResult> {
    await this.randomDelay(1_000, 2_000);
    const success = await this.page
      .locator(".posting-headline h2:has-text('Thank you'), .success-page")
      .first()
      .isVisible()
      .catch(() => false);
    return success
      ? { success: true }
      : { success: false, errorMessage: "Lever submission not confirmed" };
  }

  async logout(reporter: StepReporter): Promise<void> {
    await reporter.log("info", "Lever requires no logout");
  }
}

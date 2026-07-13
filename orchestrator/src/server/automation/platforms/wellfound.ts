/**
 * Wellfound (formerly AngelList) platform adapter.
 * External application forms — no native easy-apply; we navigate to the
 * external ATS link after clicking "Apply".
 */

import type {
  ApplicationResult,
  JobApplicationInput,
  StepReporter,
} from "../browser/types";
import { BasePlatformAdapter } from "./base";

export class WellfoundAdapter extends BasePlatformAdapter {
  readonly platform = "wellfound" as const;
  readonly label = "Wellfound";

  async login(
    username: string,
    password: string,
    reporter: StepReporter,
  ): Promise<void> {
    await this.ensurePage();
    await reporter.report("login", 5, "Checking Wellfound session");
    await this.page.goto("https://wellfound.com/", {
      waitUntil: "domcontentloaded",
    });
    await this.randomDelay(1_000, 2_000);

    const loggedIn = await this.isLoggedIn([
      "[data-test='nav-avatar']",
      ".user-avatar",
    ]);
    if (loggedIn) {
      await reporter.log("info", "Wellfound session reused");
      return;
    }

    await reporter.report("login", 15, "Logging into Wellfound");
    await this.page.goto("https://wellfound.com/login", {
      waitUntil: "domcontentloaded",
    });
    await this.randomDelay(800, 1_500);
    await this.fillTextField("input[type='email']", username);
    await this.randomDelay(400, 800);
    await this.fillTextField("input[type='password']", password);
    await this.randomDelay(300, 600);
    await this.clickElement("button[type='submit']");
    await this.page.waitForLoadState("domcontentloaded");
    await this.randomDelay(2_000, 3_500);
    await reporter.log("info", "Wellfound login attempted");
  }

  async searchJobs(
    keywords: string,
    location: string,
    reporter: StepReporter,
  ): Promise<string[]> {
    await reporter.report("search", 20, "Searching Wellfound jobs");
    const q = encodeURIComponent(keywords);
    await this.page.goto(`https://wellfound.com/jobs?q=${q}`, {
      waitUntil: "domcontentloaded",
    });
    await this.randomDelay(2_000, 3_000);
    const links = await this.page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a[href*='/jobs/']"),
      )
        .map((a) => a.href)
        .filter(Boolean)
        .slice(0, 20),
    );
    return links;
  }

  async extractJob(
    jobUrl: string,
    reporter: StepReporter,
  ): Promise<Partial<JobApplicationInput>> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
    const desc = await this.page
      .locator(".job-description, [class*='description']")
      .first()
      .textContent()
      .catch(() => null);
    return { jobUrl, jobDescription: desc };
  }

  async navigateToApply(jobUrl: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
    await this.clickElement("a:has-text('Apply'), button:has-text('Apply')");
    await this.randomDelay(1_500, 2_500);
  }

  async uploadResume(
    resumePath: string,
    reporter: StepReporter,
  ): Promise<void> {
    const uploaded = await this.uploadFile("input[type='file']", resumePath);
    if (uploaded) await reporter.log("info", "Resume attached on Wellfound");
  }

  async fillForm(
    input: JobApplicationInput,
    reporter: StepReporter,
  ): Promise<void> {
    if (input.coverLetter) {
      await this.fillTextField(
        "textarea[placeholder*='cover'], textarea[name*='cover']",
        input.coverLetter,
      );
    }
  }

  async answerQuestions(
    aiAnswers: Map<string, string>,
    reporter: StepReporter,
  ): Promise<void> {
    /* No standard Q&A */
  }

  async submit(reporter: StepReporter): Promise<void> {
    await this.clickElement("button[type='submit'], button:has-text('Submit')");
    await this.randomDelay(2_000, 3_500);
  }

  async verify(reporter: StepReporter): Promise<ApplicationResult> {
    await this.randomDelay(1_000, 2_000);
    return { success: true }; // Wellfound redirects to external ATS; assume success
  }

  async logout(reporter: StepReporter): Promise<void> {
    await this.page.goto("https://wellfound.com/logout");
    await reporter.log("info", "Wellfound session ended");
  }
}

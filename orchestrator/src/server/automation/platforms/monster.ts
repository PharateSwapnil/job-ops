/**
 * Monster platform adapter.
 */

import type {
  ApplicationResult,
  JobApplicationInput,
  StepReporter,
} from "../browser/types";
import { BasePlatformAdapter } from "./base";

export class MonsterAdapter extends BasePlatformAdapter {
  readonly platform = "monster" as const;
  readonly label = "Monster";

  async login(
    username: string,
    password: string,
    reporter: StepReporter,
  ): Promise<void> {
    await this.ensurePage();
    await reporter.report("login", 5, "Checking Monster session");
    await this.page.goto("https://www.monster.com/", {
      waitUntil: "domcontentloaded",
    });
    await this.randomDelay(1_000, 2_000);
    const loggedIn = await this.isLoggedIn([
      "[data-testid='user-menu']",
      ".user-nav",
    ]);
    if (loggedIn) {
      await reporter.log("info", "Monster session reused");
      return;
    }
    await reporter.report("login", 15, "Logging into Monster");
    await this.page.goto("https://www.monster.com/login", {
      waitUntil: "domcontentloaded",
    });
    await this.randomDelay(800, 1_500);
    await this.fillTextField("input[name='email']", username);
    await this.randomDelay(400, 800);
    await this.fillTextField("input[name='password']", password);
    await this.randomDelay(300, 600);
    await this.clickElement("button[type='submit']");
    await this.page.waitForLoadState("domcontentloaded");
    await this.randomDelay(2_000, 3_500);
    await reporter.log("info", "Monster login attempted");
  }

  async searchJobs(
    keywords: string,
    location: string,
    reporter: StepReporter,
  ): Promise<string[]> {
    await reporter.report("search", 20, "Searching Monster jobs");
    const q = encodeURIComponent(keywords);
    const l = encodeURIComponent(location);
    await this.page.goto(
      `https://www.monster.com/jobs/search?q=${q}&where=${l}`,
      { waitUntil: "domcontentloaded" },
    );
    await this.randomDelay(2_000, 3_000);
    const links = await this.page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          "[data-testid='jobTitle']",
        ),
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
      .locator(".job-description, [data-testid='JobDescription']")
      .first()
      .textContent()
      .catch(() => null);
    return { jobUrl, jobDescription: desc };
  }

  async navigateToApply(jobUrl: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
    await this.clickElement(
      "[data-testid='applyButton'], a:has-text('Apply Now')",
    );
    await this.randomDelay(1_500, 2_500);
  }

  async uploadResume(
    resumePath: string,
    reporter: StepReporter,
  ): Promise<void> {
    const uploaded = await this.uploadFile("input[type='file']", resumePath);
    if (uploaded) await reporter.log("info", "Resume uploaded to Monster");
  }

  async fillForm(
    input: JobApplicationInput,
    reporter: StepReporter,
  ): Promise<void> {
    if (input.coverLetter) {
      await this.fillTextField("textarea[name*='cover']", input.coverLetter);
    }
  }

  async answerQuestions(
    aiAnswers: Map<string, string>,
    reporter: StepReporter,
  ): Promise<void> {
    /* Monster rarely has inline Q&A */
  }

  async submit(reporter: StepReporter): Promise<void> {
    await this.clickElement(
      "button[type='submit']:has-text('Apply'), button:has-text('Submit Application')",
    );
    await this.randomDelay(2_000, 3_500);
  }

  async verify(reporter: StepReporter): Promise<ApplicationResult> {
    await this.randomDelay(1_000, 2_000);
    const success = await this.page
      .locator("h1:has-text('Application Submitted'), [class*='success']")
      .first()
      .isVisible()
      .catch(() => false);
    return success
      ? { success: true }
      : { success: false, errorMessage: "Monster submission status unclear" };
  }

  async logout(reporter: StepReporter): Promise<void> {
    await this.page.goto("https://www.monster.com/logout");
    await reporter.log("info", "Monster session ended");
  }
}

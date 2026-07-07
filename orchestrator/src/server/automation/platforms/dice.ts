/**
 * Dice platform adapter.
 */

import type { ApplicationResult, JobApplicationInput, StepReporter } from "../browser/types";
import { BasePlatformAdapter } from "./base";

export class DiceAdapter extends BasePlatformAdapter {
  readonly platform = "dice" as const;
  readonly label = "Dice";

  async login(username: string, password: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    await reporter.report("login", 5, "Checking Dice session");
    await this.page.goto("https://www.dice.com/", { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_000, 2_000);
    const loggedIn = await this.isLoggedIn(["[data-cy='user-menu']", ".profile-icon"]);
    if (loggedIn) { await reporter.log("info", "Dice session reused"); return; }
    await reporter.report("login", 15, "Logging into Dice");
    await this.page.goto("https://www.dice.com/dashboard/login", { waitUntil: "domcontentloaded" });
    await this.randomDelay(800, 1_500);
    await this.fillTextField("input[id='email']", username);
    await this.randomDelay(400, 800);
    await this.fillTextField("input[id='password']", password);
    await this.randomDelay(300, 600);
    await this.clickElement("button[type='submit']");
    await this.page.waitForLoadState("domcontentloaded");
    await this.randomDelay(2_000, 3_500);
    await reporter.log("info", "Dice login attempted");
  }

  async searchJobs(keywords: string, location: string, reporter: StepReporter): Promise<string[]> {
    await reporter.report("search", 20, "Searching Dice jobs");
    const q = encodeURIComponent(keywords);
    const l = encodeURIComponent(location);
    await this.page.goto(`https://www.dice.com/jobs?q=${q}&location=${l}`, { waitUntil: "domcontentloaded" });
    await this.randomDelay(2_000, 3_000);
    const links = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-cy='card-title-link']"))
        .map((a) => a.href).filter(Boolean).slice(0, 20),
    );
    return links;
  }

  async extractJob(jobUrl: string, reporter: StepReporter): Promise<Partial<JobApplicationInput>> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
    const desc = await this.page.locator("[data-cy='jobDescription']").textContent().catch(() => null);
    return { jobUrl, jobDescription: desc };
  }

  async navigateToApply(jobUrl: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
    await this.clickElement("[data-cy='apply-button-top'], button:has-text('Easy Apply')");
    await this.randomDelay(1_500, 2_500);
  }

  async uploadResume(resumePath: string, reporter: StepReporter): Promise<void> {
    const uploaded = await this.uploadFile("input[type='file']", resumePath);
    if (uploaded) await reporter.log("info", "Resume uploaded to Dice");
  }

  async fillForm(input: JobApplicationInput, reporter: StepReporter): Promise<void> {
    if (input.coverLetter) {
      await this.fillTextField("textarea[placeholder*='cover']", input.coverLetter);
    }
  }

  async answerQuestions(aiAnswers: Map<string, string>, reporter: StepReporter): Promise<void> { /* Dice rarely has screening questions */ }

  async submit(reporter: StepReporter): Promise<void> {
    await this.clickElement("button[type='submit']:has-text('Apply'), button:has-text('Submit')");
    await this.randomDelay(2_000, 3_500);
  }

  async verify(reporter: StepReporter): Promise<ApplicationResult> {
    await this.randomDelay(1_000, 2_000);
    const success = await this.page.locator("[data-cy='success-message'], h2:has-text('Applied')").first().isVisible().catch(() => false);
    return success ? { success: true } : { success: false, errorMessage: "Dice submission status unclear" };
  }

  async logout(reporter: StepReporter): Promise<void> {
    await this.page.goto("https://www.dice.com/dashboard/logout");
    await reporter.log("info", "Dice session ended");
  }
}

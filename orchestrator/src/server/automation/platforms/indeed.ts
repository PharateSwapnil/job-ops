/**
 * Indeed platform adapter — Indeed Easy Apply.
 */

import type { ApplicationResult, JobApplicationInput, StepReporter } from "../browser/types";
import { BasePlatformAdapter } from "./base";

const INDEED_BASE = "https://www.indeed.com";

export class IndeedAdapter extends BasePlatformAdapter {
  readonly platform = "indeed" as const;
  readonly label = "Indeed";

  async login(username: string, password: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    await reporter.report("login", 5, "Checking Indeed session");
    await this.page.goto(`${INDEED_BASE}/`, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_000, 2_000);

    const alreadyLoggedIn = await this.isLoggedIn([
      "[data-testid='gnav-account-link']",
      ".gnav-LoggedInUser",
    ]);
    if (alreadyLoggedIn) {
      await reporter.log("info", "Indeed session reused");
      return;
    }

    await reporter.report("login", 15, "Logging into Indeed");
    await this.page.goto(`${INDEED_BASE}/account/login`, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_000, 2_000);
    await this.fillTextField("input[name='__email']", username);
    await this.randomDelay(400, 800);
    await this.clickElement("button[type='submit']");
    await this.randomDelay(1_000, 2_000);
    await this.fillTextField("input[name='__password']", password);
    await this.randomDelay(300, 600);
    await this.clickElement("button[type='submit']");
    await this.page.waitForLoadState("domcontentloaded");
    await this.randomDelay(2_000, 3_500);

    const loggedIn = await this.isLoggedIn(["[data-testid='gnav-account-link']"]);
    if (!loggedIn) throw new Error("Indeed login failed");
    await reporter.log("info", "Indeed login successful");
  }

  async searchJobs(keywords: string, location: string, reporter: StepReporter): Promise<string[]> {
    await reporter.report("search", 20, "Searching Indeed jobs");
    const q = encodeURIComponent(keywords);
    const l = encodeURIComponent(location);
    await this.page.goto(`${INDEED_BASE}/jobs?q=${q}&l=${l}`, { waitUntil: "domcontentloaded" });
    await this.randomDelay(2_000, 3_000);
    const links = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-jk]"))
        .map((a) => `https://www.indeed.com/viewjob?jk=${a.dataset.jk}`)
        .filter(Boolean)
        .slice(0, 20),
    );
    return links;
  }

  async extractJob(jobUrl: string, reporter: StepReporter): Promise<Partial<JobApplicationInput>> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
    const desc = await this.page.locator("#jobDescriptionText").textContent().catch(() => null);
    return { jobUrl, jobDescription: desc };
  }

  async navigateToApply(jobUrl: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_500, 2_500);
    const clicked = await this.withRetry(async () => {
      const btn = this.page.locator("#indeedApplyButton, button:has-text('Apply now')").first();
      const visible = await this.waitForVisible(btn, 8_000);
      if (!visible) throw new Error("Indeed apply button not found");
      await this.humanClick(btn);
      return true;
    }, { maxAttempts: 3, baseMs: 1_500 });
    if (!clicked) throw new Error("Could not open Indeed application");
    await this.randomDelay(1_500, 2_500);
  }

  async uploadResume(resumePath: string, reporter: StepReporter): Promise<void> {
    const uploaded = await this.uploadFile("input[type='file']", resumePath);
    if (uploaded) await reporter.log("info", "Resume uploaded to Indeed");
  }

  async fillForm(input: JobApplicationInput, reporter: StepReporter): Promise<void> {
    const nameInput = this.page.locator("input[name='applicant.name']").first();
    if (await nameInput.isVisible().catch(() => false)) {
      const val = await nameInput.inputValue().catch(() => "");
      if (!val && input.jobTitle) await this.humanType(nameInput, "");
    }
    if (input.coverLetter) {
      await this.fillTextField("textarea[name*='cover']", input.coverLetter);
    }
  }

  async answerQuestions(aiAnswers: Map<string, string>, reporter: StepReporter): Promise<void> {
    const inputs = this.page.locator("form input[type='text']:visible, form textarea:visible");
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const el = inputs.nth(i);
      const name = await el.getAttribute("name").catch(() => "");
      const answer = name ? (aiAnswers.get(name) ?? "") : "";
      if (answer) {
        await this.humanType(el, answer, { clear: true });
        await this.randomDelay(300, 600);
      }
    }
  }

  async submit(reporter: StepReporter): Promise<void> {
    await this.withRetry(async () => {
      const btn = this.page.locator("button:has-text('Submit your application')").first();
      const visible = await this.waitForVisible(btn, 8_000);
      if (!visible) throw new Error("Submit button not found");
      await this.humanClick(btn);
    }, { maxAttempts: 2 });
    await this.randomDelay(2_000, 3_500);
  }

  async verify(reporter: StepReporter): Promise<ApplicationResult> {
    await this.randomDelay(1_500, 2_500);
    const success = await this.page
      .locator("[class*='success'], h1:has-text('Application submitted')")
      .first()
      .isVisible()
      .catch(() => false);
    return success ? { success: true } : { success: false, errorMessage: "Indeed submission status unclear" };
  }

  async logout(reporter: StepReporter): Promise<void> {
    await this.page.goto(`${INDEED_BASE}/account/logout`);
    await reporter.log("info", "Indeed session ended");
  }
}

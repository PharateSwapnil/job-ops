/**
 * ZipRecruiter platform adapter.
 */

import type {
  ApplicationResult,
  JobApplicationInput,
  StepReporter,
} from "../browser/types";
import { BasePlatformAdapter } from "./base";

export class ZipRecruiterAdapter extends BasePlatformAdapter {
  readonly platform = "ziprecruiter" as const;
  readonly label = "ZipRecruiter";

  async login(
    username: string,
    password: string,
    reporter: StepReporter,
  ): Promise<void> {
    await this.ensurePage();
    await reporter.report("login", 5, "Checking ZipRecruiter session");
    await this.page.goto("https://www.ziprecruiter.com/", {
      waitUntil: "domcontentloaded",
    });
    await this.randomDelay(1_000, 2_000);
    const loggedIn = await this.isLoggedIn([
      "[aria-label='Account']",
      ".user-nav-icon",
    ]);
    if (loggedIn) {
      await reporter.log("info", "ZipRecruiter session reused");
      return;
    }
    await reporter.report("login", 15, "Logging into ZipRecruiter");
    await this.page.goto("https://www.ziprecruiter.com/login", {
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
    await reporter.log("info", "ZipRecruiter login attempted");
  }

  async searchJobs(
    keywords: string,
    location: string,
    reporter: StepReporter,
  ): Promise<string[]> {
    await reporter.report("search", 20, "Searching ZipRecruiter jobs");
    const q = encodeURIComponent(keywords);
    const l = encodeURIComponent(location);
    await this.page.goto(
      `https://www.ziprecruiter.com/candidate/search?search=${q}&location=${l}`,
      { waitUntil: "domcontentloaded" },
    );
    await this.randomDelay(2_000, 3_000);
    const links = await this.page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          "[class*='job_result_link'], a.job-listing",
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
      .locator("[class*='job_description'], .jobDescriptionSection")
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
      "button:has-text('Apply Now'), a:has-text('Apply Now')",
    );
    await this.randomDelay(1_500, 2_500);
  }

  async uploadResume(
    resumePath: string,
    reporter: StepReporter,
  ): Promise<void> {
    const uploaded = await this.uploadFile("input[type='file']", resumePath);
    if (uploaded) await reporter.log("info", "Resume uploaded to ZipRecruiter");
  }

  async fillForm(
    input: JobApplicationInput,
    reporter: StepReporter,
  ): Promise<void> {
    // ZipRecruiter often pre-fills from profile; just advance the wizard
    const nextBtn = this.page
      .locator("button:has-text('Continue'), button:has-text('Next')")
      .first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await this.humanClick(nextBtn);
      await this.randomDelay(1_000, 2_000);
    }
  }

  async answerQuestions(
    aiAnswers: Map<string, string>,
    reporter: StepReporter,
  ): Promise<void> {
    /* ZipRecruiter one-click apply rarely has questions */
  }

  async submit(reporter: StepReporter): Promise<void> {
    await this.clickElement(
      "button[type='submit']:has-text('Apply'), button:has-text('Submit')",
    );
    await this.randomDelay(2_000, 3_500);
  }

  async verify(reporter: StepReporter): Promise<ApplicationResult> {
    await this.randomDelay(1_000, 2_000);
    const success = await this.page
      .locator(
        "[class*='success'], h1:has-text('Applied'), h2:has-text('You Applied')",
      )
      .first()
      .isVisible()
      .catch(() => false);
    return success
      ? { success: true }
      : {
          success: false,
          errorMessage: "ZipRecruiter submission status unclear",
        };
  }

  async logout(reporter: StepReporter): Promise<void> {
    await this.page.goto("https://www.ziprecruiter.com/logout");
    await reporter.log("info", "ZipRecruiter session ended");
  }
}

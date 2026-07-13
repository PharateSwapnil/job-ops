/**
 * Naukri platform adapter.
 *
 * Handles Naukri's Apply With Profile flow and inline application forms.
 */

import type {
  ApplicationResult,
  JobApplicationInput,
  StepReporter,
} from "../browser/types";
import { BasePlatformAdapter } from "./base";

const NAUKRI_BASE = "https://www.naukri.com";

export class NaukriAdapter extends BasePlatformAdapter {
  readonly platform = "naukri" as const;
  readonly label = "Naukri";

  async login(
    username: string,
    password: string,
    reporter: StepReporter,
  ): Promise<void> {
    await this.ensurePage();
    await reporter.report("login", 5, "Checking Naukri session");

    await this.page.goto(`${NAUKRI_BASE}/`, { waitUntil: "domcontentloaded" });
    await this.randomDelay(1_000, 2_000);

    const alreadyLoggedIn = await this.isLoggedIn([
      ".nI-gNb-drawer__icon",
      "[class*='view-profile']",
      ".userDetails",
    ]);
    if (alreadyLoggedIn) {
      await reporter.log("info", "Naukri session reused");
      return;
    }

    await reporter.report("login", 15, "Logging into Naukri");
    await this.page.goto(`${NAUKRI_BASE}/login/`, {
      waitUntil: "domcontentloaded",
    });
    await this.randomDelay(1_000, 2_000);

    await this.fillTextField("input[placeholder*='Email']", username);
    await this.randomDelay(400, 800);
    await this.fillTextField("input[type='password']", password);
    await this.randomDelay(300, 600);
    await this.clickElement("button[type='submit']");

    await this.page.waitForLoadState("domcontentloaded");
    await this.randomDelay(2_000, 3_500);

    const loggedIn = await this.isLoggedIn([
      ".nI-gNb-drawer__icon",
      ".userDetails",
    ]);
    if (!loggedIn) throw new Error("Naukri login failed — check credentials");
    await reporter.log("info", "Naukri login successful");
  }

  async searchJobs(
    keywords: string,
    location: string,
    reporter: StepReporter,
  ): Promise<string[]> {
    await reporter.report("search", 20, "Searching Naukri jobs");
    const encoded = encodeURIComponent(
      keywords.toLowerCase().replace(/ /g, "-"),
    );
    const loc = encodeURIComponent(location.toLowerCase().replace(/ /g, "-"));
    await this.page.goto(`${NAUKRI_BASE}/${encoded}-jobs-in-${loc}`, {
      waitUntil: "domcontentloaded",
    });
    await this.randomDelay(2_000, 3_000);

    const links = await this.page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a.title"),
      );
      return anchors
        .map((a) => a.href)
        .filter(Boolean)
        .slice(0, 20);
    });
    await reporter.log("info", `Found ${links.length} Naukri jobs`);
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
      .locator(".job-desc, [class*='job-description']")
      .first()
      .textContent()
      .catch(() => null);

    return { jobUrl, jobDescription: description };
  }

  async navigateToApply(jobUrl: string, reporter: StepReporter): Promise<void> {
    await this.ensurePage();
    if (!this.page.url().includes(jobUrl.split("?")[0])) {
      await this.page.goto(jobUrl, { waitUntil: "domcontentloaded" });
      await this.randomDelay(1_500, 2_500);
    }

    const applyClicked = await this.withRetry(
      async () => {
        const btn = this.page
          .locator("button[class*='apply-button'], #apply-button, .apply-btn")
          .first();
        const visible = await this.waitForVisible(btn, 8_000);
        if (!visible) throw new Error("Naukri apply button not found");
        await this.humanClick(btn);
        return true;
      },
      { maxAttempts: 3, baseMs: 1_500 },
    );
    if (!applyClicked) throw new Error("Could not open Naukri application");
    await this.randomDelay(1_500, 2_500);
  }

  async uploadResume(
    resumePath: string,
    reporter: StepReporter,
  ): Promise<void> {
    const uploaded = await this.uploadFile(
      "input[type='file'][accept*='pdf'], input[type='file'][name*='resume']",
      resumePath,
    );
    if (uploaded) {
      await reporter.log("info", "Resume uploaded to Naukri");
      await this.randomDelay(1_500, 2_500);
    }
  }

  async fillForm(
    input: JobApplicationInput,
    reporter: StepReporter,
  ): Promise<void> {
    // Naukri often auto-fills from profile; cover letter if present
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
    const inputs = this.page.locator(
      "form input[type='text']:visible, form textarea:visible",
    );
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const el = inputs.nth(i);
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
      const answer = aiAnswers.get(labelText) ?? "";
      if (answer) {
        await this.humanType(el, answer, { clear: true });
        await this.randomDelay(300, 600);
      }
    }
  }

  async submit(reporter: StepReporter): Promise<void> {
    await this.withRetry(
      async () => {
        const btn = this.page
          .locator(
            "button[type='submit']:has-text('Apply'), button:has-text('Submit Application')",
          )
          .first();
        const visible = await this.waitForVisible(btn, 8_000);
        if (!visible) throw new Error("Submit button not found");
        await this.humanClick(btn);
      },
      { maxAttempts: 2, baseMs: 1_000 },
    );
    await this.randomDelay(2_000, 3_500);
  }

  async verify(reporter: StepReporter): Promise<ApplicationResult> {
    await this.randomDelay(1_000, 2_000);
    const success = await this.page
      .locator("[class*='success'], [class*='applied'], .apply-success")
      .first()
      .isVisible()
      .catch(() => false);

    return success
      ? { success: true }
      : { success: false, errorMessage: "Naukri application status unclear" };
  }

  async logout(reporter: StepReporter): Promise<void> {
    await this.clickElement("[class*='logout'], a:has-text('Logout')");
    await reporter.log("info", "Naukri session ended");
  }
}

/**
 * Playwright browser engine.
 *
 * Manages persistent browser profiles and reusable BrowserContexts.
 * Selenium can be substituted by implementing the BrowserEngine interface.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@infra/logger";
import { getDataDir } from "@server/config/dataDir";
import type { BrowserContext } from "playwright";
import type { BrowserEngine } from "./types";

const PROFILES_DIR = join(getDataDir(), "automation", "profiles");

function ensureProfilesDir(): void {
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

export function resolveProfileDir(tenantId: string, platform: string): string {
  ensureProfilesDir();
  const dir = join(PROFILES_DIR, tenantId, platform);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function resolveScreenshotsDir(tenantId: string): string {
  const dir = join(getDataDir(), "automation", "screenshots", tenantId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

class PlaywrightBrowserEngine implements BrowserEngine {
  private readonly contexts = new Map<string, BrowserContext>();

  async getContext(profileDir: string): Promise<BrowserContext> {
    const existing = this.contexts.get(profileDir);
    if (existing) {
      // Verify it hasn't been closed by checking page count (will throw if closed)
      try {
        existing.pages();
        return existing;
      } catch {
        this.contexts.delete(profileDir);
      }
    }

    const { chromium } = await import("playwright");

    const context = await chromium.launchPersistentContext(profileDir, {
      headless: process.env.AUTOMATION_HEADLESS !== "false",
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--disable-dev-shm-usage",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
      viewport: { width: 1366, height: 768 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "Asia/Kolkata",
      permissions: ["clipboard-read", "clipboard-write"],
    });

    // Mask webdriver property to avoid detection
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    this.contexts.set(profileDir, context);
    logger.info("Browser context created", { profileDir });
    return context;
  }

  async closeContext(profileDir: string): Promise<void> {
    const ctx = this.contexts.get(profileDir);
    if (ctx) {
      try {
        await ctx.close();
      } catch {
        // Ignore already-closed errors
      }
      this.contexts.delete(profileDir);
      logger.info("Browser context closed", { profileDir });
    }
  }

  async shutdown(): Promise<void> {
    const dirs = Array.from(this.contexts.keys());
    await Promise.allSettled(dirs.map((d) => this.closeContext(d)));
    logger.info("Browser engine shutdown complete");
  }
}

/** Singleton engine instance shared across the process */
export const browserEngine: BrowserEngine = new PlaywrightBrowserEngine();

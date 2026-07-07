/**
 * Human-like browser behaviour helpers.
 *
 * All interactions are randomised to mimic a real user and avoid
 * detection by anti-bot systems.
 */

import type { Locator, Page } from "playwright";

// ─── Delays ──────────────────────────────────────────────────────────────────

/** Random delay between `min` and `max` milliseconds */
export function randomDelay(min = 300, max = 1200): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Short pause between keypresses (20–80 ms) */
function keyDelay(): Promise<void> {
  return randomDelay(20, 80);
}

// ─── Typing ──────────────────────────────────────────────────────────────────

/**
 * Type text character-by-character with random inter-key delays.
 * Simulates natural typing speed variations.
 */
export async function humanType(
  locator: Locator,
  text: string,
  opts: { clear?: boolean } = {},
): Promise<void> {
  await locator.click();
  if (opts.clear) {
    await locator.selectAll?.();
    // Fallback: triple-click selects all
    await locator.click({ clickCount: 3 });
    await randomDelay(50, 100);
  }
  for (const char of text) {
    await locator.pressSequentially(char);
    await keyDelay();
  }
}

// ─── Mouse ───────────────────────────────────────────────────────────────────

/** Move mouse to element with a slight random offset then click */
export async function humanClick(
  locator: Locator,
  opts: { delay?: number } = {},
): Promise<void> {
  const box = await locator.boundingBox();
  if (box) {
    const offsetX = Math.floor(Math.random() * (box.width * 0.6)) - box.width * 0.3;
    const offsetY = Math.floor(Math.random() * (box.height * 0.6)) - box.height * 0.3;
    await locator.click({
      position: {
        x: box.width / 2 + offsetX,
        y: box.height / 2 + offsetY,
      },
      delay: opts.delay ?? Math.floor(Math.random() * 100 + 50),
    });
  } else {
    await locator.click({ delay: opts.delay ?? 80 });
  }
  await randomDelay(200, 600);
}

// ─── Scrolling ───────────────────────────────────────────────────────────────

/** Scroll the page naturally in random increments */
export async function humanScroll(
  page: Page,
  direction: "down" | "up" = "down",
  totalPx = 600,
): Promise<void> {
  const sign = direction === "down" ? 1 : -1;
  let scrolled = 0;
  while (scrolled < totalPx) {
    const step = Math.floor(Math.random() * 150 + 80);
    await page.mouse.wheel(0, sign * step);
    scrolled += step;
    await randomDelay(80, 300);
  }
}

// ─── Waiting ─────────────────────────────────────────────────────────────────

/** Wait for navigation to settle with a human-like pause after */
export async function waitForNavigation(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await randomDelay(500, 1500);
}

/** Wait for an element to be visible with timeout */
export async function waitForVisible(
  locator: Locator,
  timeoutMs = 15_000,
): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

// ─── Retry ───────────────────────────────────────────────────────────────────

/**
 * Exponential backoff retry.
 * Initial delay starts at `baseMs` and doubles each attempt.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxAttempts?: number;
    baseMs?: number;
    label?: string;
  } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseMs = opts.baseMs ?? 1_000;
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts) throw err;
      const delayMs = baseMs * 2 ** (attempt - 1) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

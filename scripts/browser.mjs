// Shared Playwright launcher. Uses the locally installed Chrome (or Edge) so no browser download is needed.
import { chromium } from 'playwright-core';

export async function launch() {
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel });
    } catch {
      /* try next */
    }
  }
  return chromium.launch();
}

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/** Scrolls the page so lazy images load, then returns to the top. */
export async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    const step = innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
}

/** Rough page-weight and timing numbers, good enough for a before/after slide. */
export async function metrics(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const bytes = res.reduce((s, r) => s + (r.transferSize || 0), nav?.transferSize || 0);
    const lcp = performance.getEntriesByType('largest-contentful-paint').pop();
    return {
      requests: res.length + 1,
      transferKB: Math.round(bytes / 1024),
      domContentLoadedMs: Math.round(nav?.domContentLoadedEventEnd || 0),
      loadMs: Math.round(nav?.loadEventEnd || 0),
      lcpMs: lcp ? Math.round(lcp.startTime) : null,
    };
  });
}

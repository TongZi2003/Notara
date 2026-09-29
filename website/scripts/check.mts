/**
 * Smoke-check a running copy of the website (`npm run site:dev` or
 * `npm run site:preview`): every page loads on desktop and phone widths without
 * console errors, failed requests, broken internal links or horizontal overflow.
 * Pass `--shots <dir>` to also save full-page screenshots for review.
 *
 *   tsx website/scripts/check.mts [origin] [--shots <dir>]
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const shotsAt = args.indexOf('--shots');
const shots = shotsAt >= 0 ? args[shotsAt + 1] : undefined;
const origin = (args.find((arg, index) => !arg.startsWith('--') && (shotsAt < 0 || index !== shotsAt + 1)) ?? 'http://localhost:57180').replace(/\/$/, '');
const pages = ['/', '/features/', '/philosophy/', '/install/', '/first-lesson/', '/faq/', '/404.html'];
const viewports = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

if (shots) await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const problems: string[] = [];
const internal = new Set<string>();
try {
  for (const [device, viewport] of Object.entries(viewports)) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: device === 'phone' ? 2 : 1, reducedMotion: 'reduce' });
    for (const path of pages) {
      const page = await context.newPage();
      const note = (text: string) => problems.push(`${device} ${path}: ${text}`);
      page.on('console', message => { if (message.type() === 'error') note(`console: ${message.text()}`); });
      page.on('pageerror', error => note(`pageerror: ${error.message}`));
      page.on('requestfailed', request => note(`request failed: ${request.url()}`));
      page.on('response', response => { if (response.status() >= 400) note(`HTTP ${response.status()}: ${response.url()}`); });
      await page.goto(origin + path, { waitUntil: 'networkidle' });
      await page.evaluate(async () => {
        for (const image of document.images) image.loading = 'eager';
        await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
        await document.fonts.ready;
      });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) note(`horizontal overflow ${overflow}px`);
      const broken = await page.evaluate(() => [...document.images].filter(image => !image.naturalWidth).map(image => image.getAttribute('src')));
      for (const src of broken) note(`image not loaded: ${src}`);
      for (const href of await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => (a as HTMLAnchorElement).href))) {
        if (href.startsWith(origin)) internal.add(href.split('#')[0]);
      }
      if (shots) await page.screenshot({ path: join(shots, `${device}${path.replaceAll('/', '_') || '_'}.png`), fullPage: true });
      await page.close();
    }
    await context.close();
  }
  for (const href of internal) {
    const response = await fetch(href);
    if (!response.ok) problems.push(`link ${href}: HTTP ${response.status}`);
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ origin, pages: pages.length, internalLinks: internal.size, problems }, null, 2));
if (problems.length) process.exitCode = 1;

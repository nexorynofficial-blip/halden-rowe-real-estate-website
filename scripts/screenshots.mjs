// Full-page screenshots of the key pages at desktop and mobile widths.
//   npm run build && npm run preview   (in one terminal)
//   npm run shots -- http://localhost:4321
import { mkdir } from 'node:fs/promises';
import { launch, VIEWPORTS, settle } from './browser.mjs';

const base = (process.argv[2] || 'http://localhost:4321').replace(/\/$/, '');
const out = process.argv[3] || 'screenshots';
const pages = (process.env.PAGES || '/,/listings/,/listings/1190-pepper-lane-montecito/,/agents/mara-ellison/').split(',');

await mkdir(out, { recursive: true });
const browser = await launch();
for (const [name, vp] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
  const page = await ctx.newPage();
  for (const path of pages) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await settle(page);
    const slug = path === '/' ? 'home' : path.replace(/^\/|\/$/g, '').replace(/\//g, '_');
    await page.screenshot({ path: `${out}/${slug}-${name}-fold.png` });
    await page.screenshot({ path: `${out}/${slug}-${name}-full.png`, fullPage: true });
    console.log(`saved ${slug} (${name})`);
  }
  await ctx.close();
}
await browser.close();

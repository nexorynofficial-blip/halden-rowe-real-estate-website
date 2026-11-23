// Before/after asset for outreach: the prospect's current homepage next to this build.
//   npm run compare -- https://prospect-brokerage.com [http://localhost:4321]
// Writes side-by-side PNGs to compare-output/ and copies the captures to public/compare/
// so the private /compare/ page shows them on the next build.
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import sharp from 'sharp';
import { launch, VIEWPORTS, metrics } from './browser.mjs';

const before = process.argv[2];
const after = (process.argv[3] || 'http://localhost:4321').replace(/\/$/, '') + '/';
if (!before) {
  console.error('Usage: npm run compare -- <prospect-url> [our-url]');
  process.exit(1);
}
const host = new URL(before).hostname.replace(/^www\./, '');
await mkdir('compare-output', { recursive: true });
await mkdir('public/compare', { recursive: true });

const browser = await launch();
const results = { prospect: before, generatedAt: new Date().toISOString(), before: {}, after: {} };

async function capture(url, vpName, file) {
  const vp = VIEWPORTS[vpName];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  const m = await metrics(page);
  await page.screenshot({ path: file });
  await ctx.close();
  return m;
}

const label = (text, width) =>
  Buffer.from(`<svg width="${width}" height="72" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0B2230"/><text x="24" y="45" font-family="Georgia, serif" font-size="26" fill="#F3F2EE">${text}</text></svg>`);

for (const vp of ['desktop', 'mobile']) {
  const b = `compare-output/${host}-before-${vp}.png`;
  const a = `compare-output/${host}-after-${vp}.png`;
  results.before[vp] = await capture(before, vp, b);
  results.after[vp] = await capture(after, vp, a);

  const bm = await sharp(b).metadata();
  const w = bm.width, h = bm.height, gap = 32;
  await sharp({ create: { width: w * 2 + gap, height: h + 72, channels: 3, background: '#F3F2EE' } })
    .composite([
      { input: label(`Today: ${host}`, w), left: 0, top: 0 },
      { input: label('Rebuilt', w), left: w + gap, top: 0 },
      { input: b, left: 0, top: 72 },
      { input: await sharp(a).resize(w, h, { fit: 'cover', position: 'top' }).toBuffer(), left: w + gap, top: 72 },
    ])
    .png()
    .toFile(`compare-output/${host}-side-by-side-${vp}.png`);

  await copyFile(b, `public/compare/before-${vp}.png`);
  await copyFile(a, `public/compare/after-${vp}.png`);
  console.log(`${vp}: before ${results.before[vp].transferKB} KB / ${results.before[vp].loadMs} ms, after ${results.after[vp].transferKB} KB / ${results.after[vp].loadMs} ms`);
}
await writeFile('public/compare/results.json', JSON.stringify(results, null, 2));
await browser.close();
console.log(`Done. See compare-output/ and /compare/ after the next build.`);

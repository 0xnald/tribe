// Visual QA helper: screenshots of every surface at every target viewport.
import { chromium } from '@playwright/test';

const base = process.env.BASE ?? 'http://localhost:3000';
const out = process.env.OUT ?? './shots';
const sizes = [
  ['m360', 360, 800],
  ['m390', 390, 844],
  ['m430', 430, 932],
  ['tablet', 768, 1024],
  ['desktop', 1280, 800],
  ['xl', 1600, 900],
];
const pages = [
  ['home', '/'],
  ['arena', '/arena/bonk-vs-tslax'],
  ['arena-live', '/arena/sol-vs-spyx'],
  ['arena-settled', '/arena/bonk-vs-tslax-round-1'],
  ['arena-scheduled', '/arena/sol-vs-nvdax-next'],
  ['arena-cancelled', '/arena/pengu-vs-gmex-cancelled'],
  ['my-arenas', '/my-arenas'],
  ['create', '/create'],
  ['404', '/arena/nope'],
];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const browser = await chromium.launch();
for (const [sname, w, h] of sizes) {
  if (only && !only.includes(sname)) continue;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  for (const [pname, path] of pages) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const hasH = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (hasH) console.log(`H-OVERFLOW ${sname} ${pname}`);
    await page.screenshot({ path: `${out}/${sname}-${pname}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log('done');

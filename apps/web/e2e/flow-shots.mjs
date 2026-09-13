// Screenshot the Back flow and My Arenas on mobile and desktop.
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:3000';
const out = process.env.OUT ?? './shots';
const [w, h] = (process.env.SIZE ?? '390x844').split('x').map(Number);
const name = process.env.NAME ?? 'flow';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  isMobile: w < 768,
  hasTouch: w < 768,
});
const page = await ctx.newPage();
await page.goto(base + '/arena/sol-vs-spyx', { waitUntil: 'networkidle' });
await page.getByTestId('hero-back-b').click();
const sheet = page.getByTestId('back-sheet');
await sheet.waitFor();
let i = 0;
const shot = async (label) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-${i++}-${label}.png` });
};
await shot('side');
await sheet.getByTestId('back-next').click();
await shot('method');
await sheet.getByTestId('back-next').click();
await page.waitForTimeout(1200);
await shot('amount');
await sheet.getByTestId('back-next').click();
await shot('preview');
await sheet.getByTestId('back-next').click();
await shot('confirm');
await sheet.getByTestId('back-confirm').click();
await page.waitForTimeout(2500);
await shot('success');
await page.goto(base + '/my-arenas', { waitUntil: 'networkidle' });
await shot('my-arenas');
await browser.close();
console.log('done');

import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:3000';
const out = process.env.OUT ?? './shots';
const [w, h] = (process.env.SIZE ?? '360x800').split('x').map(Number);
const r = process.env.ROUTE ?? 'home';
const path = r === 'home' ? '/' : '/' + r;
const name = process.env.NAME ?? 'm';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(base + path, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const steps = Number(process.env.STEPS ?? 3);
for (let i = 0; i < steps; i++) {
  await page.evaluate((y) => window.scrollTo(0, y), i * (h - 80));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}-${i}.png` });
}
await browser.close();

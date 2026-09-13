import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** axe-core WCAG 2.x AA scan of the core surfaces, including the open Back sheet. */
const PAGES = ['/', '/arena/bonk-vs-tslax', '/my-arenas', '/create'];

for (const path of PAGES) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map(
        (v) =>
          `${v.id}: ${v.help} (${v.nodes.length})\n  ${v.nodes
            .map((n) => n.target.join(' '))
            .slice(0, 3)
            .join('\n  ')}`,
      ),
    ).toEqual([]);
  });
}

test('axe: Back sheet open', async ({ page }) => {
  await page.goto('/arena/sol-vs-spyx');
  await page.getByTestId('hero-back-b').click();
  await page.getByTestId('back-sheet').waitFor();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
});

test('keyboard: cards and CTAs are reachable and the sheet traps focus', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('hero-back-a').waitFor();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  // tab from the top until a Back button in the hero has focus
  let found = false;
  for (let i = 0; i < 80 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') === 'hero-back-a',
    );
  }
  expect(found).toBe(true);
  await page.keyboard.press('Enter');
  const sheet = page.getByTestId('back-sheet');
  await expect(sheet).toBeVisible();
  // focus stays inside the dialog
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  expect(inside).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

import { expect, test } from '@playwright/test';

/** Home → Arena → Back → Preview → (demo) confirm → My Arenas. */
test('critical flow: discover, back a side, see the position', async ({ page, isMobile }) => {
  await page.goto('/');
  const hero = page.getByTestId('arena-hero');
  await expect(hero).toBeVisible();
  await expect(hero.getByText('Own what you believe in.')).toBeVisible();
  await expect(page.getByRole('button', { name: /DEMO data/ }).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: /PROTOCOL\. Open for details|DEVNET PROTOCOL/ }).first(),
  ).toBeVisible();

  // open an Arena from the feed
  const card = page.locator('[data-testid="arena-card"][data-provenance="demo"]').first();
  const slug = await card.getAttribute('data-slug');
  await card.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/arena/${slug}`));
  await expect(page.getByRole('heading', { name: 'Who is winning?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Arena Rewards' })).toBeVisible();

  // back the underdog (side b unless a is smaller)
  const backB = page.getByTestId('hero-back-b');
  if (await backB.count()) {
    await backB.click();
  } else {
    await page.goto('/arena/sol-vs-spyx');
    await page.getByTestId('hero-back-b').click();
  }
  const sheet = page.getByTestId('back-sheet');
  await expect(sheet).toHaveAttribute('data-step', 'side');
  await sheet.getByTestId('back-next').click();
  await expect(sheet).toHaveAttribute('data-step', 'method');
  await sheet.getByTestId('back-next').click();
  await expect(sheet).toHaveAttribute('data-step', 'amount');
  await expect(sheet.getByText('Tribe fee (0.50%)')).toBeVisible();
  await expect(sheet.getByText('$0.50')).toBeVisible();
  await sheet.getByTestId('back-next').click();
  await expect(sheet).toHaveAttribute('data-step', 'preview');
  await expect(sheet.getByText(/Your Tribe Position Vault/)).toBeVisible();
  await sheet.getByTestId('back-next').click();
  await expect(sheet).toHaveAttribute('data-step', 'confirm');
  await expect(sheet.getByText('Demo — no transaction is sent.')).toBeVisible();
  await sheet.getByTestId('back-confirm').click();
  await expect(sheet).toHaveAttribute('data-step', 'success', { timeout: 10_000 });
  await expect(sheet.getByText(/YOU'RE BACKING/)).toBeVisible();

  // My Arenas shows the position with the asset / Arena distinction
  await sheet.getByRole('link', { name: 'My Arenas' }).click();
  await expect(page).toHaveURL(/my-arenas/);
  const pos = page.getByTestId('position-card').first();
  await expect(pos).toBeVisible();
  await expect(pos.getByText(/^Your /)).toBeVisible();
  await expect(pos.getByText('Arena result')).toBeVisible();
  await expect(pos.getByRole('button', { name: /DEMO data/ })).toBeVisible();

  // exit (demo)
  page.once('dialog', (d) => void d.accept());
  await pos.getByTestId('exit').click();
  await expect(page.getByText(/Demo position exited/)).toBeVisible();

  if (isMobile) {
    // bottom tabs reachable by thumb
    const tabs = page.getByRole('navigation', { name: 'Primary' }).last();
    await expect(tabs.getByRole('link', { name: 'Explore' })).toBeVisible();
  }
});

test('Arena pages: settled, scheduled, cancelled and unknown', async ({ page }) => {
  await page.goto('/arena/bonk-vs-tslax-round-1');
  await expect(page.getByText(/WINS$/).first()).toBeVisible();
  await expect(page.getByTestId('hero-back-a')).toHaveCount(0);
  await page.goto('/arena/sol-vs-nvdax-next');
  await expect(page.getByText(/^Opens in /).first()).toBeVisible();
  await page.goto('/arena/pengu-vs-gmex-cancelled');
  await expect(page.getByText(/Arena cancelled/).first()).toBeVisible();
  await page.goto('/arena/does-not-exist');
  await expect(page.getByText(/This Arena doesn/)).toBeVisible();
});

test('no horizontal overflow on any core page', async ({ page }) => {
  for (const path of ['/', '/arena/bonk-vs-tslax', '/my-arenas', '/create']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, `${path} overflows horizontally`).toBe(false);
  }
});

test('share card and metadata exist for an Arena', async ({ request }) => {
  const og = await request.get('/arena/bonk-vs-tslax/opengraph-image');
  expect(og.status()).toBe(200);
  expect(og.headers()['content-type']).toContain('image/png');
  const html = await (await request.get('/arena/bonk-vs-tslax')).text();
  expect(html).toContain('og:title');
  expect(html).toContain('BONK vs TSLAx');
});

test('protocol status reports the devnet program', async ({ request }) => {
  const r = await request.get('/api/protocol');
  expect(r.ok()).toBeTruthy();
  const j = (await r.json()) as {
    data: { cluster: string; programId: string; executable: boolean };
  };
  expect(j.data.cluster).toBe('devnet');
  expect(j.data.programId).toBe('shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4');
});

import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the core Tribe paths. Runs against a production build
 * (`pnpm build && pnpm start`) or an already running dev server (BASE_URL).
 */
const baseURL = process.env['BASE_URL'] ?? 'http://localhost:3100';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: { baseURL, colorScheme: 'dark', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  ...(process.env['BASE_URL']
    ? {}
    : {
        webServer: {
          command: 'npx next start --port 3100',
          url: 'http://localhost:3100',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});

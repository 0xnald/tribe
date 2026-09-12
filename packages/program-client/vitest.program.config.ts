import { defineConfig } from 'vitest/config';

/** LiteSVM program tests — require the built .so (Linux/macOS only; run in WSL). */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

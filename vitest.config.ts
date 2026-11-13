import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['apps/**/test/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    maxWorkers: 2,
  },
});

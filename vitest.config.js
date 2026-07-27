import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    // The setup hook builds every model's indexes against a fresh in-memory mongod
    // per file; that legitimately takes longer than the 10s default hook budget.
    hookTimeout: 60000,
    // Only DB-backed suites need the in-memory mongod.
    setupFiles: process.env.NO_DB ? [] : ['./tests/setup.js'],
  },
});

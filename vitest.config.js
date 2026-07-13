import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    // Only DB-backed suites need the in-memory mongod.
    setupFiles: process.env.NO_DB ? [] : ['./tests/setup.js'],
  },
});

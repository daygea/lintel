import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    // Each test file starts its own in-memory mongod (tests/setup.js). Two knobs
    // keep that reliable on a laptop: a generous hookTimeout for a cold start +
    // index build, and a capped fork pool so only a few servers boot at once (the
    // contention, not the work, is what caused start/monitor timeouts). Default 2;
    // raise it on an idle machine with VITEST_MAX_FORKS=4, or drop to
    // VITEST_MAX_FORKS=1 to run strictly sequentially on a very busy one.
    // (maxForks is a number, not the --maxWorkers CLI flag, which conflicts with the
    // forks pool's thread defaults in vitest 2.x.)
    hookTimeout: 120000,
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: Number(process.env.VITEST_MAX_FORKS) || 1,
      },
    },
    // Only DB-backed suites need the in-memory mongod.
    setupFiles: process.env.NO_DB ? [] : ['./tests/setup.js'],
  },
});

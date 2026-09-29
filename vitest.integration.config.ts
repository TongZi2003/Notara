import { defineConfig } from 'vitest/config';

// Real DSH process/port/filesystem seams with isolated data and an OS-chosen port.
// Real-model acceptance is recorded separately from scripted-model checks.
export default defineConfig({
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    // Zero matches is a failure by design: an empty lane must not pass.
    passWithNoTests: false,
    // These files boot real hosts and databases. Bound startup concurrency so
    // the full suite measures behaviour rather than workstation contention.
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

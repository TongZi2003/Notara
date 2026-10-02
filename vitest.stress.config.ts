import { defineConfig } from 'vitest/config';

// Bounded real-host concurrency in a temporary Vault, separate from routine
// unit and integration lanes so the measured run is intentional and repeatable.
export default defineConfig({
  test: {
    name: 'stress',
    include: ['tests/stress/**/*.test.ts'],
    passWithNoTests: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});

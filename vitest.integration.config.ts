import { defineConfig } from 'vitest/config';

// Integration lane: real DSH process/port/filesystem seams only. Live model
// or provider calls belong in the later vitest.live config; harness fixtures
// must use an isolated DSH_HOME and an OS-chosen port, never a shared service.
export default defineConfig({
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    // Zero matches is a failure by design: an empty lane must not pass.
    passWithNoTests: false,
  },
});

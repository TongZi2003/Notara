import { defineConfig } from 'vitest/config';

// Live lane: real models and external services only. This lane never runs in
// the default `npm test` sweep because it needs provider credentials and
// network reachability; a missing credential must surface as BLOCKED, never as
// a silently skipped pass. Deterministic provider-assembly assertions may live
// here only when they need the real installed adapters, not a host boot.
export default defineConfig({
  test: {
    name: 'live',
    include: ['tests/live/**/*.test.ts'],
    // Zero matches is a failure by design: an empty lane must not pass.
    passWithNoTests: false,
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});

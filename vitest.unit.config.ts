import { defineConfig } from 'vitest/config';

// Unit lane: pure contract/domain logic, no DSH host boot and no real ports.
// Node is the default Vitest environment; schema validators, clock and id
// helpers under packages/* must stay runnable here without a live harness.
export default defineConfig({
  test: {
    name: 'unit',
    include: ['tests/unit/**/*.test.ts'],
    // Zero matches is a failure by design: an empty lane must not pass.
    passWithNoTests: false,
  },
});

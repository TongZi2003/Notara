import { defineConfig } from 'vitest/config';

// Launcher and patch contracts; no DSH host boot or real model calls.
export default defineConfig({
  test: {
    name: 'unit',
    include: ['tests/unit/**/*.test.ts'],
    // Zero matches is a failure by design: an empty lane must not pass.
    passWithNoTests: false,
    // Private-file tests launch real PowerShell ACL checks. Keep their Windows
    // concurrency bounded in local runs and CI so cold starts stay comparable.
    ...(process.platform === 'win32' ? { maxWorkers: 2 } : {}),
  },
});

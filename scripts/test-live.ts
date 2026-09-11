/**
 * Live-lane runner for P1.5 capability probes.
 *
 * The live lane needs real provider credentials and network reachability, so it
 * is deliberately separate from `test:unit` / `test:integration`. This runner
 * boots the real Vitest live config, reports which external credential is
 * missing BEFORE running, and never turns a missing credential into a silent
 * pass: the real-retrieval cases are skipped with an explicit BLOCKED reason
 * while the deterministic provider-assembly cases still run.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const credentials = [
  { name: 'DEEPSEEK_API_KEY', used: 'web_search (dsh-web-search-deepseek) and the DeepSeek chat adapter' },
] as const;

const missing = credentials.filter(entry => (process.env[entry.name] ?? '').trim().length === 0);

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('test-live: Node 24 or newer is required');
  process.exit(1);
}

console.log('test-live: live lane requires network access and the following external credentials:');
for (const entry of credentials) {
  const state = missing.some(candidate => candidate.name === entry.name) ? 'MISSING (BLOCKED)' : 'present';
  console.log(`  - ${entry.name}: ${state} · used by ${entry.used}`);
}
if (missing.length > 0) {
  console.log('test-live: credentialed search/model probes are BLOCKED; anonymous HTTP fetch and provider assembly still run.');
}

const child = spawn(
  process.execPath,
  [resolve(project, 'node_modules/.bin/vitest'), 'run', '--config', 'vitest.live.config.ts', ...process.argv.slice(2)],
  { cwd: project, stdio: 'inherit', env: process.env },
);
child.once('error', error => { console.error('test-live: runner failed:', error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  if (signal !== null) process.exit(1);
  process.exit(code ?? 1);
});

import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startVaultPersistent, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { isBrowserBlockedPort, readVaultState } from '../../scripts/vault-launcher-state.ts';
import { connectVault } from '../fixtures/vault-http.ts';

// Simulate the OS returning a blocked random port without binding a fixed port
// or changing the computer's TCP range. Only rejected startup candidates are
// synthetic; the final candidate loads the real pinned DSH Host as usual.
async function simulateBlockedCandidates(root: string, candidates: number): Promise<{ marker: string; restore(): void }> {
  const marker = join(root, 'rejected-candidates.json');
  const preload = join(root, 'blocked port preload.mjs');
  await writeFile(preload, `
import { readFile, writeFile } from 'node:fs/promises';
if (process.argv[1]?.replaceAll('\\\\', '/').endsWith('/@deepseek-ai/dsh/lib/bin.js')) {
  const path = ${JSON.stringify(marker)};
  let seen;
  try { seen = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; seen = []; }
  if (seen.length < ${candidates}) {
    const port = seen.length % 2 === 0 ? 6000 : 6667;
    seen.push({ port, pid: process.pid });
    await writeFile(path, JSON.stringify(seen));
    console.log('dsh web: http://127.0.0.1:' + port + '/?token=synthetic-rejected-token');
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
}
`);
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `${previous ?? ''} --import=${pathToFileURL(preload).href}`.trim();
  return { marker, restore() { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; } };
}

test('automatic port selection stops blocked candidates before publishing a real, usable Host and keeps its port on restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-browser-port-'));
  let runtime: VaultRuntime | undefined;
  let restore: (() => void) | undefined;
  try {
    const injection = await simulateBlockedCandidates(root, 2);
    restore = injection.restore;
    // Keep the fixture loader outside the persistent instance being seeded.
    runtime = await startVaultPersistent(join(root, 'instance'), { port: 0, testModel: true });
    const rejected = JSON.parse(await readFile(injection.marker, 'utf8')) as Array<{ port: number; pid: number }>;
    expect(rejected.map(candidate => candidate.port)).toEqual([6000, 6667]);
    for (const candidate of rejected) expect(() => process.kill(candidate.pid, 0)).toThrow();
    const usable = Number(new URL(runtime.authUrl).port);
    expect(usable).toBeGreaterThan(0);
    expect(isBrowserBlockedPort(usable)).toBe(false);
    expect((await readVaultState(runtime.root))?.port).toBe(usable);
    expect(JSON.parse(await readFile(join(runtime.root, 'launcher.json'), 'utf8')).authUrl).toBe(runtime.authUrl);
    expect(runtime.log()).toContain('6000');
    expect(runtime.log()).not.toContain('synthetic-rejected-token');
    const client = await connectVault(runtime);
    try { expect(await client.createSession()).toBeTruthy(); } finally { await client.close(); }
    await runtime.restart();
    expect(Number(new URL(runtime.authUrl).port)).toBe(usable);
    const resumed = await connectVault(runtime);
    try { expect(await resumed.createSession()).toBeTruthy(); } finally { await resumed.close(); }
  } finally {
    restore?.();
    await runtime?.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

test('repeated blocked allocation fails with a useful error and removes rejected children and the login record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-blocked-port-limit-'));
  let restore: (() => void) | undefined;
  try {
    const injection = await simulateBlockedCandidates(root, 100);
    restore = injection.restore;
    const instance = join(root, 'instance');
    await expect(startVaultPersistent(instance, { port: 0, testModel: true })).rejects.toThrow('被浏览器禁止访问');
    const rejected = JSON.parse(await readFile(injection.marker, 'utf8')) as Array<{ pid: number }>;
    expect(rejected).toHaveLength(8);
    for (const candidate of rejected) expect(() => process.kill(candidate.pid, 0)).toThrow();
    await expect(readFile(join(instance, 'launcher.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readVaultState(instance))?.port).toBe(0);
  } finally {
    restore?.();
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

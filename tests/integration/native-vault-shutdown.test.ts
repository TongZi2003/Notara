import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { startVaultPersistent } from '../../scripts/dev-isolated.ts';
import { liveVaultUrl } from '../../scripts/vault-launcher-state.ts';
import { packageBin } from '../../scripts/package-bin.ts';

const execFileAsync = promisify(execFile);

test('shutdown awaits the stopping-state atomic write before removing the owned controller record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'Notara delayed shutdown & '));
  const root = join(directory, 'synthetic runtime');
  const config = join(directory, 'private config', 'remote.json');
  const statePath = config.replace(/\.json$/, '.controller.json');
  const marker = join(directory, 'stopping publication.json');
  const profile = join(directory, 'isolated user profile');
  const preload = join(directory, 'delay owned stopping rename.mjs');
  const project = resolve('.');
  let seed: Awaited<ReturnType<typeof startVaultPersistent>> | undefined;
  let cleanup: (() => Promise<unknown>) | undefined;
  try {
    await mkdir(profile, { recursive: true });
    await writeFile(preload, `
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (target.hostname === 'api.github.com') return new Response(null, { status: 404 });
  if (['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) return nativeFetch(input, init);
  throw new Error('Network access blocked by isolated shutdown test: ' + target.hostname);
};
if (process.argv.includes('__supervisor')) {
  const fs = await import('node:fs');
  const { syncBuiltinESMExports } = await import('node:module');
  const nativeRename = fs.default.promises.rename;
  fs.default.promises.rename = async (from, to) => {
    let delayed = false;
    if (String(to) === ${JSON.stringify(statePath)}) {
      const value = JSON.parse(await fs.default.promises.readFile(from, 'utf8'));
      if (value.phase === 'stopping') {
        delayed = true;
        await fs.default.promises.writeFile(${JSON.stringify(marker)}, JSON.stringify({ delayed: true, published: false }));
        await new Promise(resolve => setTimeout(resolve, 5_000));
      }
    }
    await nativeRename(from, to);
    if (delayed) await fs.default.promises.writeFile(${JSON.stringify(marker)}, JSON.stringify({ delayed: true, published: true }));
  };
  syncBuiltinESMExports();
}
`);
    seed = await startVaultPersistent(root, { port: 0, testModel: true });
    const port = Number(new URL(seed.authUrl).port);
    expect(port).toBeGreaterThan(0);
    await seed.stop(); seed = undefined;
    const env = {
      ...process.env, USERPROFILE: profile, HOME: profile,
      APPDATA: join(profile, 'AppData', 'Roaming'), LOCALAPPDATA: join(profile, 'AppData', 'Local'),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}`.trim(),
    };
    const command = (name: 'local-start' | 'stop' | 'status') => execFileAsync(process.execPath, [
      packageBin(project, 'tsx', 'tsx'), join(project, 'scripts', 'remote-vault.ts'), name,
      '--root', root, '--config', config, ...(name === 'local-start' ? ['--port', String(port)] : []),
    ], { cwd: project, env, encoding: 'utf8', timeout: 150_000, maxBuffer: 64_000, windowsHide: true });
    cleanup = async () => { await command('stop').catch(() => undefined); await command('status'); };
    await command('local-start');
    expect(await liveVaultUrl(root)).toBeDefined();
    expect((await command('stop')).stdout).toContain('shutdown requested');
    await expect.poll(async () => JSON.parse(await readFile(marker, 'utf8').catch(() => '{}')), { timeout: 10_000 }).toMatchObject({ delayed: true, published: true });
    expect(await stat(statePath).then(() => true, () => false), 'controller record reappeared after its delayed stopping publication').toBe(false);
    expect(await liveVaultUrl(root)).toBeUndefined();
    expect((await command('status')).stdout).toContain('not running');
  } finally {
    await seed?.stop();
    await cleanup?.().catch(() => undefined);
    expect(await liveVaultUrl(root).catch(() => undefined)).toBeUndefined();
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);

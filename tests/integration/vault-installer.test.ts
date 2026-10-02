import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync } from 'fflate';
import { expect, test } from 'vitest';
import { installVault } from '../../scripts/install-vault.ts';

const runtime = { dsh: '0.2.0-rc.1', cordis: '4.0.4', dataVersion: 1 };
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
type BundleFiles = Record<string, string>;

function filesFor(version: string, contract = runtime): BundleFiles {
  return {
    'package.json': JSON.stringify({ name: 'notara-test-bundle', devDependencies: { '@deepseek-ai/dsh': contract.dsh, '@deepseek-ai/cordis': contract.cordis } }),
    'package-lock.json': '{}\n',
    'examples/native-vault/package.json': JSON.stringify({ name: '@notara/vault-native', version }),
    'examples/native-vault/client.js': `/* packaged build ${version} */\n`,
    'docs/runtime/update-contract.json': JSON.stringify({ dataVersion: contract.dataVersion }),
    'scripts/install-vault.ts': '// required installer source\n',
    'README.md': `Notara ${version}\n`,
  };
}

function inventory(files: BundleFiles, version: string): Uint8Array {
  return text(JSON.stringify({
    format: 1,
    version,
    files: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, createHash('sha256').update(value).digest('hex')])),
  }, null, 2) + '\n');
}

async function writeBundle(root: string, version = '1.0.0', contract = runtime): Promise<BundleFiles> {
  const files = filesFor(version, contract);
  for (const [path, value] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, value);
  }
  await writeFile(join(root, 'notara-files.json'), inventory(files, version));
  return files;
}

function archive(files: BundleFiles, version: string, extra: BundleFiles = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, value] of Object.entries(files)) entries[`notara/${path}`] = text(value);
  for (const [path, value] of Object.entries(extra)) entries[`notara/${path}`] = text(value);
  entries['notara/notara-files.json'] = inventory(files, version);
  return zipSync(entries, { level: 6 });
}

function releaseFetcher(version: string, contract: typeof runtime, bytes: Uint8Array): typeof fetch {
  const tag = `v${version}`;
  const archiveName = `notara-${version}.zip`;
  const base = `https://github.com/TongZi2003/Notara/releases/download/${tag}`;
  const release = {
    tag_name: tag, draft: false, prerelease: false,
    html_url: `https://github.com/TongZi2003/Notara/releases/tag/${tag}`,
    assets: [
      { name: 'notara-update.json', browser_download_url: `${base}/notara-update.json` },
      { name: archiveName, browser_download_url: `${base}/${archiveName}` },
    ],
  };
  const manifest = { format: 1, version, runtime: contract, archive: archiveName, sha256: createHash('sha256').update(bytes).digest('hex') };
  return (async input => {
    const url = String(input);
    if (url.endsWith('/releases/latest')) return Response.json(release);
    if (url.endsWith('/notara-update.json')) return Response.json(manifest);
    if (url.endsWith(`/${archiveName}`)) return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    return new Response('unexpected URL', { status: 404 });
  }) as typeof fetch;
}

function mockRun(commands: string[]) {
  return async (cwd: string, entry: string, args: string[]) => {
    commands.push(`${entry} ${args.join(' ')}`);
    if (args[0] === 'ci') {
      const target = join(cwd, 'node_modules', 'fflate');
      await mkdir(join(cwd, 'node_modules'), { recursive: true });
      await cp(resolve('node_modules/fflate'), target, { recursive: true });
      await mkdir(join(cwd, 'node_modules', 'tsx', 'dist'), { recursive: true });
      await writeFile(join(cwd, 'node_modules', 'tsx', 'package.json'), JSON.stringify({ bin: { tsx: 'dist/cli.mjs' } }));
    }
    if (args.at(-1)?.replaceAll('\\', '/').endsWith('scripts/build-native-vault.ts')) {
      await writeFile(join(cwd, 'examples/native-vault/client.js'), 'synthetic platform build output\n');
    }
  };
}

function assertBuildCommands(commands: string[], offset: number): void {
  expect(commands[offset]!.replaceAll('\\', '/')).toMatch(/node_modules\/tsx\/dist\/cli\.mjs .+scripts\/build-native-vault\.ts$/);
  expect(commands[offset + 1]!.replaceAll('\\', '/')).toMatch(/node_modules\/tsx\/dist\/cli\.mjs .+scripts\/build-pixel-classroom\.ts$/);
}

test('quick install stages the bundle, keeps unrelated files and can reinstall its own inventory', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-installer-success-'));
  const root = join(base, '解压 & 安装');
  try {
    await mkdir(root);
    await writeBundle(root);
    await writeFile(join(root, 'my-extra.txt'), 'keep me');
    await mkdir(join(root, 'vault-runtime'));
    await writeFile(join(root, 'vault-runtime', 'classroom.json'), 'private learning data');
    const commands: string[] = [];
    const messages: string[] = [];
    const options = { npmEntry: 'mock-npm-cli.js', skipLatest: true, run: mockRun(commands), assertIdle: async () => {}, log: (message: string) => messages.push(message) };

    await expect(installVault(root, options)).resolves.toBe('1.0.0');
    const percentages = messages.flatMap(message => { const match = message.match(/^\[[#-]{20}\] (\d+)%/); return match ? [Number(match[1])] : []; });
    expect(percentages[0]).toBe(20);
    expect(percentages.at(-1)).toBe(95); // Desktop shortcut setup is the final bootstrap stage.
    expect(percentages).toEqual([...percentages].sort((a, b) => a - b));
    expect(await readFile(join(root, 'my-extra.txt'), 'utf8')).toBe('keep me');
    expect(await readFile(join(root, 'vault-runtime', 'classroom.json'), 'utf8')).toBe('private learning data');
    expect(await readFile(join(root, 'examples/native-vault/client.js'), 'utf8')).toBe('synthetic platform build output\n');
    expect(await stat(join(root, 'node_modules', 'fflate', 'package.json'))).toBeTruthy();
    expect(commands[0]).toBe('mock-npm-cli.js ci --include=dev --no-audit --no-fund');
    assertBuildCommands(commands, 1);

    // The staged build did not change any inventoried release files, so a second install remains valid.
    commands.length = 0;
    await expect(installVault(root, options)).resolves.toBe('1.0.0');
    expect(commands).toHaveLength(3);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('quick install refuses a source checkout and a modified managed file before running npm', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-installer-protection-'));
  try {
    const checkout = join(base, 'checkout');
    await mkdir(checkout);
    await writeBundle(checkout);
    await mkdir(join(checkout, '.git'));
    const commands: string[] = [];
    const options = { npmEntry: 'mock-npm-cli.js', skipLatest: true, run: mockRun(commands), assertIdle: async () => {}, log: () => {} };
    await expect(installVault(checkout, options)).rejects.toThrow(/源码仓库/);
    expect(commands).toEqual([]);

    const extracted = join(base, 'extracted');
    await mkdir(extracted);
    await writeBundle(extracted);
    await writeFile(join(extracted, 'README.md'), 'local source edit');
    await expect(installVault(extracted, options)).rejects.toThrow(/文件已修改或损坏/);
    expect(commands).toEqual([]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('build failure leaves the extracted release and its existing files in place', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-installer-rollback-'));
  const root = join(base, 'bundle');
  try {
    await mkdir(root);
    await writeBundle(root);
    const original = await readFile(join(root, 'README.md'), 'utf8');
    const commands: string[] = [];
    const run = async (cwd: string, entry: string, args: string[]) => {
      await mockRun(commands)(cwd, entry, args);
      if (args.at(-1)?.replaceAll('\\', '/').endsWith('scripts/build-pixel-classroom.ts')) throw new Error('synthetic build failure');
    };
    await expect(installVault(root, { npmEntry: 'mock-npm-cli.js', skipLatest: true, run, assertIdle: async () => {}, log: () => {} })).rejects.toThrow('synthetic build failure');
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(original);
    await expect(stat(join(root, 'node_modules'))).rejects.toThrow();
    expect(await readFile(join(root, '.notara-install.lock')).catch(() => '')).toBe('');
    expect(commands[0]).toBe('mock-npm-cli.js ci --include=dev --no-audit --no-fund');
    assertBuildCommands(commands, 1);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('npm ci failure leaves the existing release and its node_modules untouched', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-installer-npm-failure-'));
  const root = join(base, 'bundle');
  try {
    await mkdir(root);
    await writeBundle(root);
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'custom-installed-file.txt'), 'keep on failure');
    const before = await readFile(join(root, 'notara-files.json'), 'utf8');
    const run = async () => { throw new Error('synthetic npm ci failure'); };

    await expect(installVault(root, { npmEntry: 'mock-npm-cli.js', skipLatest: true, run, assertIdle: async () => {}, log: () => {} })).rejects.toThrow('synthetic npm ci failure');
    expect(await readFile(join(root, 'notara-files.json'), 'utf8')).toBe(before);
    expect(await readFile(join(root, 'node_modules', 'custom-installed-file.txt'), 'utf8')).toBe('keep on failure');
    expect(await readFile(join(root, 'examples/native-vault/package.json'), 'utf8')).toContain('1.0.0');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('latest network failure is reported and never changes the package to a false latest state', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-installer-network-'));
  const root = join(base, 'bundle');
  try {
    await mkdir(root);
    await writeBundle(root);
    const commands: string[] = [];
    const fetcher = (async () => new Response('offline', { status: 503 })) as typeof fetch;
    await expect(installVault(root, { npmEntry: 'mock-npm-cli.js', fetcher, run: mockRun(commands), assertIdle: async () => {}, log: () => {} })).rejects.toThrow(/无法检查更新/);
    expect(await readFile(join(root, 'examples/native-vault/package.json'), 'utf8')).toContain('1.0.0');
    await expect(stat(join(root, 'node_modules'))).rejects.toThrow();
    expect(commands).toEqual([]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a newer release installs its code into the extraction folder without touching Vault data', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-installer-latest-'));
  const root = join(base, 'bundle');
  const dataRoot = join(base, 'vault-runtime');
  try {
    await mkdir(root);
    await writeBundle(root);
    await mkdir(dataRoot);
    await writeFile(join(dataRoot, 'lesson.md'), 'student data remains untouched');
    const nextRuntime = { dsh: '0.3.0', cordis: '4.0.4', dataVersion: 2 };
    const nextFiles = filesFor('2.0.0', nextRuntime);
    const commands: string[] = [];
    const fetcher = releaseFetcher('2.0.0', nextRuntime, archive(nextFiles, '2.0.0'));

    await expect(installVault(root, { npmEntry: 'mock-npm-cli.js', fetcher, run: mockRun(commands), assertIdle: async () => {}, log: () => {} })).resolves.toBe('2.0.0');
    expect(await readFile(join(root, 'examples/native-vault/package.json'), 'utf8')).toContain('2.0.0');
    expect(await readFile(join(dataRoot, 'lesson.md'), 'utf8')).toBe('student data remains untouched');
    expect(commands.slice(0, 2)).toEqual(['mock-npm-cli.js ci --include=dev --no-audit --no-fund', 'mock-npm-cli.js ci --include=dev --no-audit --no-fund']);
    assertBuildCommands(commands, 2);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a ZIP hash failure leaves the existing release and dependencies untouched', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-installer-hash-failure-'));
  const root = join(base, 'bundle');
  try {
    await mkdir(root);
    await writeBundle(root);
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'existing.txt'), 'keep');
    const commands: string[] = [];
    const validArchive = archive(filesFor('2.0.0'), '2.0.0');
    const trustedFetcher = releaseFetcher('2.0.0', runtime, validArchive);
    const fetcher = (async (input, init) => {
      const response = await trustedFetcher(input, init);
      if (!String(input).endsWith('.zip')) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return new Response(new Uint8Array([...bytes, 0]));
    }) as typeof fetch;

    await expect(installVault(root, { npmEntry: 'mock-npm-cli.js', fetcher, run: mockRun(commands), assertIdle: async () => {}, log: () => {} })).rejects.toThrow(/校验失败/);
    expect(await readFile(join(root, 'examples/native-vault/package.json'), 'utf8')).toContain('1.0.0');
    expect(await readFile(join(root, 'node_modules', 'existing.txt'), 'utf8')).toBe('keep');
    expect(commands).toEqual(['mock-npm-cli.js ci --include=dev --no-audit --no-fund']);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a failed mid-switch restores all moved release files and keeps old dependencies', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-installer-switch-rollback-'));
  const root = join(base, 'bundle');
  try {
    await mkdir(root);
    await writeBundle(root);
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'existing.txt'), 'old dependency tree');
    const oldReadme = await readFile(join(root, 'README.md'), 'utf8');
    const oldDocs = await readFile(join(root, 'docs/runtime/update-contract.json'), 'utf8');
    let idleChecks = 0;
    const assertIdle = async () => {
      idleChecks++;
      if (idleChecks === 2) {
        const work = (await readdir(root)).find(name => name.startsWith('.notara-install-'));
        if (!work) throw new Error('installer staging directory was not found');
        const blocker = join(root, work, 'backup/examples');
        await mkdir(blocker, { recursive: true });
        await writeFile(join(blocker, 'held-open-by-another-process'), 'synthetic share violation');
      }
    };
    const commands: string[] = [];

    await expect(installVault(root, { npmEntry: 'mock-npm-cli.js', skipLatest: true, run: mockRun(commands), assertIdle, log: () => {} })).rejects.toThrow();
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(oldReadme);
    expect(await readFile(join(root, 'docs/runtime/update-contract.json'), 'utf8')).toBe(oldDocs);
    expect(await readFile(join(root, 'node_modules', 'existing.txt'), 'utf8')).toBe('old dependency tree');
    await expect(stat(join(root, '.notara-install-journal.json'))).rejects.toThrow();
    expect(idleChecks).toBe(2);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a downloaded release archive cannot add an unlisted npm lockfile', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-installer-unlisted-'));
  const root = join(base, 'bundle');
  try {
    await mkdir(root);
    await writeBundle(root);
    const nextFiles = filesFor('2.0.0');
    const commands: string[] = [];
    const fetcher = releaseFetcher('2.0.0', runtime, archive(nextFiles, '2.0.0', { 'npm-shrinkwrap.json': '{"lockfileVersion":1,"packages":{}}\n' }));

    await expect(installVault(root, { npmEntry: 'mock-npm-cli.js', fetcher, run: mockRun(commands), assertIdle: async () => {}, log: () => {} })).rejects.toThrow(/清单|未登记|额外文件/);
    expect(await readFile(join(root, 'examples/native-vault/package.json'), 'utf8')).toContain('1.0.0');
    expect(commands).toEqual(['mock-npm-cli.js ci --include=dev --no-audit --no-fund']);
  } finally { await rm(base, { recursive: true, force: true }); }
});

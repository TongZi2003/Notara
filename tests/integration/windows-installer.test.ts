import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const windowsOnly = process.platform === 'win32';
const projectRoot = resolve('.');
const installerScript = join(projectRoot, 'scripts', 'windows-install.ps1');
const installerCommand = join(projectRoot, '安装 Notara.cmd');
const fixtureScript = join(projectRoot, 'tests', 'fixtures', 'windows-installer-qa.ps1');

interface MockCaseResult {
  Case: string;
  ExitCode: number;
  WingetLookups: number;
  PackageIds: string[];
  InstallerCalls: number;
  ShortcutCalls: number;
}

interface InstallerQaResult {
  MockCases: MockCaseResult[];
  ActualNodeCheck: { ExitCode: number; DetectedUsableNode: boolean; Output: string };
}

async function removeQaRoot(directory: string): Promise<void> {
  const actual = await realpath(directory);
  const tempParent = await realpath(tmpdir());
  if (dirname(actual).toLowerCase() !== tempParent.toLowerCase() || !basename(actual).startsWith('Notara 安装 QA & ')) {
    throw new Error(`Refusing to clean a path outside this test's mkdtemp root: ${actual}`);
  }
  await rm(actual, { recursive: true, force: true });
}

test('Windows installer PowerShell source has a UTF-8 BOM and its cmd entry is ASCII CRLF', async () => {
  const script = await readFile(installerScript);
  expect(script.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const fixture = await readFile(fixtureScript);
  expect(fixture.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));

  const command = await readFile(installerCommand);
  expect(command.every(byte => byte <= 0x7f)).toBe(true);
  const text = command.toString('ascii');
  expect(text).toContain('\r\n');
  expect(text.replaceAll('\r\n', '')).not.toContain('\n');
  expect(text.replaceAll('\r\n', '')).not.toContain('\r');
});

test.skipIf(!windowsOnly)('Windows installer bootstrap fail-closes side effects and recognizes the usable Node on PATH', async () => {
  const windowsRoot = process.env.WINDIR ?? process.env.SystemRoot;
  if (!windowsRoot) throw new Error('Windows root environment variable is missing.');
  const powershellPath = join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const nodeNpmEntry = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  await readFile(nodeNpmEntry);

  const directory = await mkdtemp(join(tmpdir(), 'Notara 安装 QA & '));
  try {
    const { stdout, stderr } = await execFileAsync(powershellPath, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixtureScript,
      '-TestRoot', directory, '-NodeExecutable', process.execPath,
    ], {
      cwd: projectRoot,
      env: process.env,
      encoding: 'utf8',
      timeout: 90_000,
      maxBuffer: 256_000,
      windowsHide: true,
    });
    const result = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8')) as InstallerQaResult;
    const byName = new Map(result.MockCases.map(row => [row.Case, row]));

    expect(result.MockCases).toHaveLength(8);
    expect([...byName.keys()].sort()).toEqual([
      'checkonly-missing', 'checkonly-valid', 'missing-git', 'missing-node',
      'no-shortcuts-success', 'no-update', 'no-winget', 'winget-failure',
    ]);
    expect(byName.get('missing-node')).toMatchObject({ ExitCode: 0, WingetLookups: 1, PackageIds: ['OpenJS.NodeJS.LTS'], InstallerCalls: 1, ShortcutCalls: 0 });
    expect(byName.get('missing-git')).toMatchObject({ ExitCode: 0, WingetLookups: 1, PackageIds: ['Git.Git'], InstallerCalls: 1, ShortcutCalls: 0 });
    expect(byName.get('no-winget')).toMatchObject({ ExitCode: 1, WingetLookups: 1, PackageIds: [], InstallerCalls: 0, ShortcutCalls: 0 });
    expect(byName.get('winget-failure')).toMatchObject({ ExitCode: 1, WingetLookups: 1, PackageIds: ['OpenJS.NodeJS.LTS'], InstallerCalls: 0, ShortcutCalls: 0 });
    expect(byName.get('no-update')).toMatchObject({ ExitCode: 0, WingetLookups: 0, PackageIds: [], InstallerCalls: 1, ShortcutCalls: 0 });
    expect(byName.get('checkonly-valid')).toMatchObject({ ExitCode: 0, WingetLookups: 0, PackageIds: [], InstallerCalls: 0, ShortcutCalls: 0 });
    expect(byName.get('checkonly-missing')).toMatchObject({ ExitCode: 1, WingetLookups: 0, PackageIds: [], InstallerCalls: 0, ShortcutCalls: 0 });
    expect(byName.get('no-shortcuts-success')).toMatchObject({ ExitCode: 0, WingetLookups: 0, PackageIds: [], InstallerCalls: 1, ShortcutCalls: 0 });
    expect(result.ActualNodeCheck).toMatchObject({ ExitCode: 0, DetectedUsableNode: true });
    expect(result.ActualNodeCheck.Output).toMatch(/Node\.js \d+\.\d+\.\d+ 和 npm \d+\.\d+\.\d+：可用/);
    expect(stdout).toContain('actual-node-checkonly');
    expect(stderr).toBe('');
  } finally {
    await removeQaRoot(directory);
  }
}, 100_000);

import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { startVaultPersistent } from '../../scripts/dev-isolated.ts';
import { liveVaultUrl, readVaultState } from '../../scripts/vault-launcher-state.ts';

const execFileAsync = promisify(execFile);
const projectRoot = resolve('.');
const qaEvidenceRoot = resolve('.runtime/windows-shortcut-qa');
const launcherPath = resolve('scripts/windows-launcher.ps1');
const shortcutInteropPath = resolve('scripts/windows-shortcuts.ps1');
const powershellPath = join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const windowsOnly = process.platform === 'win32';

interface Sandbox {
  directory: string;
  profile: string;
  runtimeRoot: string;
  controllerConfig: string;
  shortcutDirectory: string;
  env: NodeJS.ProcessEnv;
}

interface ShortcutInfo {
  targetPath: string;
  arguments: string;
  workingDirectory: string;
  description: string;
  windowStyle: number;
  iconLocation: string;
}

const controllerStatePath = (config: string): string => `${config.replace(/\.[^./\\]+$/, '')}.controller.json`;

async function randomPort(): Promise<number> {
  const server = createServer();
  return await new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('Could not reserve a temporary QA port.')); return; }
      const port = address.port;
      server.close(error => error ? reject(error) : resolvePort(port));
    });
  });
}

async function createSandbox(): Promise<Sandbox> {
  await mkdir(qaEvidenceRoot, { recursive: true });
  const directory = await mkdtemp(join(tmpdir(), 'Notara 快捷方式🧪 مرحبا & '));
  const profile = join(directory, '临时用户 & profile');
  const runtimeRoot = join(directory, '用户数据 & 课堂', 'Notara 运行目录');
  const controllerConfig = join(directory, '私有配置 & remote', 'remote.json');
  const shortcutDirectory = join(directory, '临时桌面 & 快捷方式');
  const preload = join(qaEvidenceRoot, 'windows-shortcut-network-guard.mjs');
  await mkdir(profile, { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(join(directory, '私有配置 & remote'), { recursive: true });
  await writeFile(preload, [
    'const nativeFetch = globalThis.fetch.bind(globalThis);',
    'globalThis.fetch = async (input, init) => {',
    '  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);',
    '  if (["127.0.0.1", "localhost", "::1"].includes(target.hostname)) return nativeFetch(input, init);',
    '  if (target.hostname === "api.github.com") return new Response(null, { status: 404 });',
    '  throw new Error(`External network blocked by Windows shortcut QA: ${target.hostname}`);',
    '};',
  ].join('\n'), 'utf8');
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(' ');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    USERPROFILE: profile,
    APPDATA: join(profile, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(profile, 'AppData', 'Local'),
    HOME: profile,
    DSH_HOME: join(directory, '临时 DSH & home'),
    NODE_OPTIONS: nodeOptions,
  };
  return { directory, profile, runtimeRoot, controllerConfig, shortcutDirectory, env };
}

async function withProcessEnvironment<T>(environment: NodeJS.ProcessEnv, action: () => Promise<T>): Promise<T> {
  const keys = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'DSH_HOME', 'NODE_OPTIONS'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;
  for (const key of keys) {
    const value = environment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await action(); }
  finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runLauncher(
  action: 'Start' | 'Stop' | 'Shortcuts',
  sandbox: Sandbox,
  options: { port?: number; noBrowser?: boolean; shortcutDirectory?: string; scriptPath?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const args = [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', options.scriptPath ?? launcherPath,
    '-Action', action, '-RuntimeRoot', sandbox.runtimeRoot, '-ControllerConfig', sandbox.controllerConfig, '-NoUI',
  ];
  if ((action === 'Start' || action === 'Shortcuts') && options.port !== undefined) args.push('-Port', String(options.port));
  if (options.noBrowser) args.push('-NoBrowser');
  if (action === 'Shortcuts') args.push('-ShortcutDirectory', options.shortcutDirectory ?? sandbox.shortcutDirectory);
  const stdoutPath = join(sandbox.directory, `launcher-${action}-${randomUUID()}.stdout.log`);
  const stderrPath = join(sandbox.directory, `launcher-${action}-${randomUUID()}.stderr.log`);
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  return await new Promise(resolveResult => {
    let settled = false;
    const closeLogs = (): void => { closeSync(stdoutFd); closeSync(stderrFd); };
    const finish = async (code: number, suffix = ''): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeLogs();
      resolveResult({
        code,
        stdout: `${await readFile(stdoutPath, 'utf8')}${suffix}`,
        stderr: await readFile(stderrPath, 'utf8'),
      });
    };
    const child = spawn(powershellPath, args, {
      cwd: projectRoot,
      env: sandbox.env,
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      void finish(-1, '\nPowerShell launcher timed out.');
    }, 150_000);
    child.once('error', error => { void finish(-1, `${error.message}\n`); });
    // Wait for the PowerShell process itself; detached Notara children may
    // inherit these file handles and delay Node's later `close` event.
    child.once('exit', code => { void finish(code ?? -1); });
  });
}

async function runPowerShellCommand(command: string, env: NodeJS.ProcessEnv): Promise<string> {
  const result = await execFileAsync(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 64_000,
    windowsHide: true,
  });
  return result.stdout.trim();
}

function psLiteral(value: string): string { return `'${value.replace(/'/g, "''")}'`; }

async function readShortcut(path: string, env: NodeJS.ProcessEnv): Promise<ShortcutInfo> {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `. ${psLiteral(shortcutInteropPath)}`,
    `  $link = Read-NotaraShortcut -Path ${psLiteral(path)}`,
    '  $json = [pscustomobject]@{ targetPath = $link.TargetPath; arguments = $link.Arguments; workingDirectory = $link.WorkingDirectory; description = $link.Description; windowStyle = $link.WindowStyle; iconLocation = $link.IconLocation } | ConvertTo-Json -Compress',
    '  [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($json))',
  ].join('\n');
  const encoded = await runPowerShellCommand(command, env);
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf16le')) as ShortcutInfo;
}

async function createForeignShortcut(path: string, workingDirectory: string, env: NodeJS.ProcessEnv): Promise<void> {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `. ${psLiteral(shortcutInteropPath)}`,
    `Write-NotaraShortcut -Path ${psLiteral(path)} -TargetPath 'notepad.exe' -WorkingDirectory ${psLiteral(workingDirectory)} -Arguments '-not-owned-by-this-install'`,
  ].join('\n');
  await runPowerShellCommand(command, env);
}

async function stopIfStillRunning(sandbox: Sandbox): Promise<void> {
  if (await liveVaultUrl(sandbox.runtimeRoot).catch(() => undefined)) {
    await runLauncher('Stop', sandbox, { noBrowser: true });
  }
}

async function waitForControllerReady(path: string): Promise<{ phase: string; ownsVault: boolean; remoteActive: boolean; runtimeRoot: string }> {
  const deadline = Date.now() + 5_000;
  let current: { phase: string; ownsVault: boolean; remoteActive: boolean; runtimeRoot: string } | undefined;
  while (Date.now() < deadline) {
    current = JSON.parse(await readFile(path, 'utf8')) as typeof current;
    if (current?.phase === 'ready') return current;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Controller state did not reach ready after the Start command: ${JSON.stringify(current)}`);
}

test('Windows PowerShell launcher source carries the UTF-8 BOM required for Chinese text in PowerShell 5', async () => {
  const scriptBytes = await readFile(launcherPath);
  expect(scriptBytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect((await readFile(shortcutInteropPath)).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
});

test.skipIf(!windowsOnly)('Windows Start refuses install locks and recovery journals before launching the Vault', async () => {
  const sandbox = await createSandbox();
  try {
    for (const marker of ['.notara-install.lock', '.notara-install-journal.json']) {
      const projectDirectory = join(sandbox.directory, `temporary-project-${marker.endsWith('.lock') ? 'lock' : 'journal'}`);
      const scriptsDirectory = join(projectDirectory, 'scripts');
      await mkdir(scriptsDirectory, { recursive: true });
      const isolatedLauncher = join(scriptsDirectory, 'windows-launcher.ps1');
      await writeFile(isolatedLauncher, await readFile(launcherPath));
      await writeFile(join(projectDirectory, marker), 'synthetic in-progress installation\n', 'utf8');

      const result = await runLauncher('Start', sandbox, { noBrowser: true, scriptPath: isolatedLauncher });
      expect(result.code, `${result.stdout}\n${result.stderr}`).not.toBe(0);
      expect(result.stdout).toContain('正在安装或有未恢复的安装记录');
      expect(result.stdout).not.toContain('依赖尚未安装');
    }
  } finally {
    await rm(sandbox.directory, { recursive: true, force: true });
  }
}, 30_000);

test.skipIf(!windowsOnly)('Windows PowerShell 5 starts and stops one isolated synthetic Vault through Unicode paths', async () => {
  const version = await runPowerShellCommand('$PSVersionTable.PSVersion.ToString()', process.env);
  expect(version).toMatch(/^5\.1\./);

  const sandbox = await createSandbox();
  let seed: Awaited<ReturnType<typeof startVaultPersistent>> | undefined;
  try {
    seed = await withProcessEnvironment(sandbox.env, () => startVaultPersistent(sandbox.runtimeRoot, { port: 0, testModel: true }));
    const port = Number(new URL(seed.authUrl).port);
    expect(port).toBeGreaterThan(0);
    expect((await readVaultState(sandbox.runtimeRoot))?.testModel).toBe(true);
    await seed.stop();
    seed = undefined;

    const retainedMarker = join(sandbox.runtimeRoot, '快捷方式验收资料 & retained.txt');
    await writeFile(retainedMarker, 'synthetic classroom marker\n', 'utf8');

    const started = await runLauncher('Start', sandbox, { port, noBrowser: true });
    expect(started.code, `${started.stdout}\n${started.stderr}`).toBe(0);
    const loginUrl = await liveVaultUrl(sandbox.runtimeRoot);
    expect(loginUrl).toBeDefined();
    expect(Number(new URL(loginUrl!).port)).toBe(port);

    const statePath = controllerStatePath(sandbox.controllerConfig);
    const controller = await waitForControllerReady(statePath);
    expect(controller.phase).toBe('ready');
    expect(controller.ownsVault).toBe(true);
    expect(controller.remoteActive).toBe(false);
    expect(controller.runtimeRoot.toLowerCase()).toBe((await realpath(sandbox.runtimeRoot)).toLowerCase());

    const repeatedStart = await runLauncher('Start', sandbox, { port, noBrowser: true });
    expect(repeatedStart.code, `${repeatedStart.stdout}\n${repeatedStart.stderr}`).toBe(0);
    expect(await liveVaultUrl(sandbox.runtimeRoot)).toBe(loginUrl);

    const stopped = await runLauncher('Stop', sandbox, { noBrowser: true });
    expect(stopped.code, `${stopped.stdout}\n${stopped.stderr}`).toBe(0);
    expect(await liveVaultUrl(sandbox.runtimeRoot)).toBeUndefined();
    await expect(readFile(statePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(retainedMarker, 'utf8')).toBe('synthetic classroom marker\n');
    expect((await readVaultState(sandbox.runtimeRoot))?.testModel).toBe(true);

    const repeatedStop = await runLauncher('Stop', sandbox, { noBrowser: true });
    expect(repeatedStop.code, `${repeatedStop.stdout}\n${repeatedStop.stderr}`).toBe(0);
    expect(await liveVaultUrl(sandbox.runtimeRoot)).toBeUndefined();
  } finally {
    await seed?.stop();
    await stopIfStillRunning(sandbox);
    await rm(sandbox.directory, { recursive: true, force: true });
  }
}, 180_000);

test.skipIf(!windowsOnly).each([2, Infinity])('Start waits for durable controller state and handles %s sharing violations', async failures => {
  const sandbox = await createSandbox();
  const statePath = controllerStatePath(sandbox.controllerConfig);
  const gate = join(sandbox.directory, 'controller-write-gate');
  const injector = pathToFileURL(resolve('tests/fixtures/controller-state-write-fault.mjs')).href;
  sandbox.env.NODE_OPTIONS += ` --import=${injector}`;
  sandbox.env.NOTARA_TEST_CONTROLLER_STATE = statePath;
  sandbox.env.NOTARA_TEST_CONTROLLER_GATE = gate;
  sandbox.env.NOTARA_TEST_CONTROLLER_FAILURES = String(failures);
  let seed: Awaited<ReturnType<typeof startVaultPersistent>> | undefined;
  let launching: ReturnType<typeof runLauncher> | undefined;
  try {
    seed = await withProcessEnvironment(sandbox.env, () => startVaultPersistent(sandbox.runtimeRoot, { port: 0, testModel: true }));
    const port = Number(new URL(seed.authUrl).port);
    await seed.stop(); seed = undefined;
    let settled = false;
    let launchResult: Awaited<ReturnType<typeof runLauncher>> | undefined;
    launching = runLauncher('Start', sandbox, { port, noBrowser: true }).then(result => { settled = true; launchResult = result; return result; });
    await expect.poll(async () => {
      if (await stat(`${gate}.entered`).then(() => true, () => false)) return 'entered';
      if (launchResult) throw new Error(`Controller write gate was not reached: ${JSON.stringify(launchResult)}`);
      return 'waiting';
    }, { timeout: 45_000 }).toBe('entered');
    const stored = JSON.parse(await readFile(statePath, 'utf8')) as { endpoint: string; token: string; phase: string };
    expect(stored.phase).toBe('starting');
    const response = await fetch(new URL('/v1/status', stored.endpoint), { headers: { authorization: `Bearer ${stored.token}` } });
    expect(response.status).toBe(200);
    expect((await response.json() as { phase: string }).phase).toBe('starting');
    expect(settled, 'Start reported success before the ready state was saved').toBe(false);
    await writeFile(`${gate}.release`, 'continue');
    const result = await launching;
    if (Number.isFinite(failures)) {
      expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(Number(await readFile(`${gate}.attempts`, 'utf8'))).toBeGreaterThan(failures);
      expect((await waitForControllerReady(statePath)).ownsVault).toBe(true);
      expect(await liveVaultUrl(sandbox.runtimeRoot)).toBeDefined();
    } else {
      expect(result.code, `${result.stdout}\n${result.stderr}`).not.toBe(0);
      expect(result.stdout + result.stderr).toContain('Synthetic controller state sharing violation');
      await expect.poll(() => liveVaultUrl(sandbox.runtimeRoot), { timeout: 15_000 }).toBeUndefined();
      await expect.poll(() => stat(statePath).then(() => true, () => false), { timeout: 15_000 }).toBe(false);
    }
  } finally {
    await writeFile(`${gate}.release`, 'cleanup');
    await launching;
    await seed?.stop();
    await stopIfStillRunning(sandbox);
    await rm(sandbox.directory, { recursive: true, force: true });
  }
}, 180_000);

test.skipIf(!windowsOnly)('Windows PowerShell 5 creates COM-readable shortcuts and refuses another install shortcut', async () => {
  const sandbox = await createSandbox();
  try {
    const shortcutPort = await randomPort();
    const generated = await runLauncher('Shortcuts', sandbox, { port: shortcutPort });
    expect(generated.code, `${generated.stdout}\n${generated.stderr}`).toBe(0);
    const startPath = join(sandbox.shortcutDirectory, 'Start Notara.lnk');
    const stopPath = join(sandbox.shortcutDirectory, 'Stop Notara.lnk');
    expect((await stat(startPath)).isFile()).toBe(true);
    expect((await stat(stopPath)).isFile()).toBe(true);

    const start = await readShortcut(startPath, sandbox.env);
    const stop = await readShortcut(stopPath, sandbox.env);
    const quoted = (value: string): string => `"${value.replace(/(\\+)$/, '$1$1')}"`;
    const expectedBase = `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ${quoted(launcherPath)}`;
    expect(start.targetPath.toLowerCase()).toBe(powershellPath.toLowerCase());
    expect(stop.targetPath.toLowerCase()).toBe(powershellPath.toLowerCase());
    expect(start.workingDirectory.toLowerCase()).toBe(projectRoot.toLowerCase());
    expect(stop.workingDirectory.toLowerCase()).toBe(projectRoot.toLowerCase());
    const canonicalRuntimeRoot = await realpath(sandbox.runtimeRoot);
    const canonicalConfig = join(await realpath(join(sandbox.directory, '私有配置 & remote')), 'remote.json');
    const canonicalStart = `${expectedBase} -Action Start -RuntimeRoot ${quoted(canonicalRuntimeRoot)} -ControllerConfig ${quoted(canonicalConfig)}`;
    const canonicalStop = `${expectedBase} -Action Stop -RuntimeRoot ${quoted(canonicalRuntimeRoot)} -ControllerConfig ${quoted(canonicalConfig)}`;
    expect(start.arguments).toBe(`${canonicalStart} -Port ${shortcutPort}`);
    expect(stop.arguments).toBe(canonicalStop);
    expect(start.description).toContain(projectRoot);
    expect(stop.description).toContain(projectRoot);
    expect(start.windowStyle).toBe(7);
    const expectedIcon = `${join(projectRoot, 'resources/icons/notara.ico')},0`;
    expect(start.iconLocation).toBe(expectedIcon);
    expect(stop.iconLocation).toBe(expectedIcon);

    const repeated = await runLauncher('Shortcuts', sandbox, { port: shortcutPort });
    expect(repeated.code, `${repeated.stdout}\n${repeated.stderr}`).toBe(0);
    expect((await readShortcut(startPath, sandbox.env)).arguments).toBe(start.arguments);
    expect((await readShortcut(stopPath, sandbox.env)).arguments).toBe(stop.arguments);
    expect((await readShortcut(startPath, sandbox.env)).iconLocation).toBe(expectedIcon);
    expect((await readShortcut(stopPath, sandbox.env)).iconLocation).toBe(expectedIcon);

    const foreignDirectory = join(sandbox.directory, '其他安装 & 不覆盖');
    await mkdir(foreignDirectory, { recursive: true });
    const foreignStart = join(foreignDirectory, 'Start Notara.lnk');
    await createForeignShortcut(foreignStart, foreignDirectory, sandbox.env);
    const refused = await runLauncher('Shortcuts', sandbox, { shortcutDirectory: foreignDirectory });
    expect(refused.code).not.toBe(0);
    expect(await stat(foreignStart)).toBeDefined();
    await expect(stat(join(foreignDirectory, 'Stop Notara.lnk'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(sandbox.directory, { recursive: true, force: true });
  }
}, 90_000);

test.skipIf(!windowsOnly)('Windows close shortcut reports an external Vault and leaves it running', async () => {
  const sandbox = await createSandbox();
  let external: Awaited<ReturnType<typeof startVaultPersistent>> | undefined;
  try {
    external = await withProcessEnvironment(sandbox.env, () => startVaultPersistent(sandbox.runtimeRoot, { port: 0, testModel: true }));
    const url = external.authUrl;
    const stateBefore = await readVaultState(sandbox.runtimeRoot);
    expect(stateBefore?.testModel).toBe(true);

    const result = await runLauncher('Stop', sandbox, { noBrowser: true });
    expect(result.code).not.toBe(0);
    expect(await liveVaultUrl(sandbox.runtimeRoot)).toBe(url);
    expect((await readVaultState(sandbox.runtimeRoot))?.port).toBe(Number(new URL(url).port));
  } finally {
    await external?.stop();
    await stopIfStillRunning(sandbox);
    await rm(sandbox.directory, { recursive: true, force: true });
  }
}, 90_000);

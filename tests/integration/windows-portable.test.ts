import { execFile, spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { liveVaultUrl, readVaultState } from '../../scripts/vault-launcher-state.ts';
import { connectVault } from '../fixtures/vault-http.ts';

const archive = process.env.NOTARA_TEST_PORTABLE_ARCHIVE;
test.skipIf(process.platform !== 'win32' || !archive)('portable ZIP starts with bundled Node, serves a lesson and stops without system Node or Git', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'Notara 免安装🧪 & '));
  const project = join(directory, 'notara'), runtimeRoot = join(directory, 'synthetic runtime');
  const config = join(directory, 'private', 'remote.json'), profile = join(directory, 'profile');
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const ps = join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const execute = promisify(execFile);
  let run: ((action: string) => Promise<{ code: number; output: string }>) | undefined;
  try {
    // Exercise Windows' standard ZIP reader, not the same library that writes
    // the package. Environment values keep Unicode paths out of shell source.
    const extract = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:NOTARA_QA_ARCHIVE, $env:NOTARA_QA_OUTPUT)";
    await execute(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(extract, 'utf16le').toString('base64')], {
      env: { ...process.env, NOTARA_QA_ARCHIVE: resolve(archive!), NOTARA_QA_OUTPUT: directory },
      cwd: directory, windowsHide: true, timeout: 150_000, maxBuffer: 1_000_000,
    });
    expect(await readdir(project), 'Windows extraction must include all English launchers').toEqual(expect.arrayContaining(['start-notara.cmd', 'stop-notara.cmd', 'create-notara-shortcuts.cmd']));
    await mkdir(profile);
    const guard = join(directory, 'network-guard.mjs');
    await writeFile(guard, `const original=globalThis.fetch;globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(['localhost','127.0.0.1','::1'].includes(url.hostname))return original(input,init);if(url.hostname==='api.github.com')return new Response(null,{status:404});throw Error('Portable QA blocked external network');};`);
    const env: NodeJS.ProcessEnv = { ...process.env,
      HOME: profile, USERPROFILE: profile, APPDATA: join(profile, 'AppData/Roaming'), LOCALAPPDATA: join(profile, 'AppData/Local'), DSH_HOME: join(directory, 'dsh-home'),
      NODE_OPTIONS: `--import=${pathToFileURL(guard).href}`, npm_execpath: undefined };
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    env.Path = `${systemRoot}\\System32;${systemRoot};${dirname(ps)}`;
    // No global runtime may satisfy the launcher accidentally.
    const missing = await execute(ps, ['-NoProfile', '-NonInteractive', '-Command', "@(Get-Command node.exe,git.exe -ErrorAction SilentlyContinue).Count"], { env, windowsHide: true });
    expect(missing.stdout.trim()).toBe('0');
    const node = join(project, 'runtime/node.exe');
    const seed = join(directory, 'seed.mjs');
    await writeFile(seed, `const {startVaultPersistent}=await import(${JSON.stringify(pathToFileURL(join(project, 'scripts/dev-native-vault.ts')).href)});const runtime=await startVaultPersistent(${JSON.stringify(runtimeRoot)},{port:0,testModel:true});await runtime.stop();`);
    const seeded = await execute(node, [seed], { cwd: project, env, windowsHide: true, timeout: 90_000, maxBuffer: 64_000 });
    expect(seeded.stdout).not.toContain('native-vault client:');
    const port = (await readVaultState(runtimeRoot))!.port;
    run = async action => {
      const log = join(directory, `${action}.log`), fd = openSync(log, 'w');
      const code = await new Promise<number>((done, reject) => {
        const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(project, 'scripts/windows-launcher.ps1'), '-Action', action,
          '-RuntimeRoot', runtimeRoot, '-ControllerConfig', config, '-NoUI', '-NoBrowser', ...(action === 'Start' ? ['-Port', String(port)] : [])],
        { cwd: project, env, windowsHide: true, stdio: ['ignore', fd, fd] });
        const timer = setTimeout(() => { child.kill(); reject(new Error('Portable launcher timed out')); }, 150_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', status => { clearTimeout(timer); done(status ?? -1); });
      }).finally(() => closeSync(fd));
      return { code, output: await readFile(log, 'utf8') };
    };
    const started = await run('Start');
    expect(started.code, started.output).toBe(0);
    expect(started.output).not.toContain('native-vault client:');
    const authUrl = await liveVaultUrl(runtimeRoot);
    expect(authUrl).toBeDefined();
    const login = await fetch(authUrl!, { redirect: 'manual' });
    expect(login.status).toBe(303);
    const cookies = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const page = await fetch(new URL('/', authUrl!), { headers: { cookie: cookies } });
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const harness = await connectVault({ root: runtimeRoot, authUrl: authUrl!, log: () => '', restart: async () => {}, stop: async () => {} });
    try {
      harness.approvals.auto('allowed-once');
      const session = await harness.createSession();
      await harness.ask(session, '便携版检查', { '便携版检查': { calls: [{ name: 'bash', arguments: { command: "printf 'portable-shell-ok\\n'", description: '检查便携版教师命令环境' } }], text: '便携版合成课堂响应正常。' } });
      expect((await harness.turns(session)).length).toBeGreaterThan(0);
      expect((await harness.outcomes(session)).some(outcome => !outcome.failed && outcome.text.includes('portable-shell-ok'))).toBe(true);
    } finally { await harness.close(); }
    const stopped = await run('Stop');
    expect(stopped.code, stopped.output).toBe(0);
    expect(await liveVaultUrl(runtimeRoot)).toBeUndefined();
    expect((await readVaultState(runtimeRoot))?.testModel).toBe(true);
    await expect(stat(join(project, 'LICENSE'))).resolves.toBeDefined();
    await expect(stat(join(project, 'runtime/LICENSE'))).resolves.toBeDefined();
    await expect(stat(join(project, 'install-notara.cmd'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    if (run && await liveVaultUrl(runtimeRoot).catch(() => undefined)) await run('Stop');
    expect(await liveVaultUrl(runtimeRoot).catch(() => undefined)).toBeUndefined();
    expect(dirname(await realpath(directory)).toLowerCase()).toBe((await realpath(tmpdir())).toLowerCase());
    await rm(directory, { recursive: true, force: true });
  }
}, 300_000);

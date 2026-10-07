import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { spawn as interceptedSpawn, execFile as interceptedExecFile } from 'node:child_process';
import { writePrivateFile, type RemoteAccessConfig } from '../../scripts/remote-access-config.ts';
import { startNgrokTunnel } from '../../scripts/remote-ngrok.ts';

const childProcessMocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: childProcessMocks.spawn as unknown as typeof actual.spawn,
    execFile: childProcessMocks.execFile as unknown as typeof actual.execFile,
  };
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('ngrok child stdout and stderr are written to the private log with credentials redacted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-ngrok-log-'));
  const childScript = join(root, 'synthetic-ngrok.mjs');
  const baseConfig = join(root, 'ngrok.yml');
  const policyPath = join(root, 'traffic-policy.yml');
  const overlayPath = join(root, 'overlay.yml');
  const controllerLog = join(root, 'controller.log');
  const apiPort = await availablePort();
  const rootToken = 'synthetic-root-token-123';
  const agentToken = 'synthetic-agent-token-456';
  const password = 'synthetic-remote-password-42';

  const actualChildProcess = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const execFileStub = ((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === 'function') queueMicrotask(() => (callback as (error: Error | null, stdout: string, stderr: string) => void)(null, '', ''));
    return new EventEmitter() as never;
  }) as unknown as typeof actualChildProcess.execFile;
  vi.mocked(interceptedExecFile).mockImplementation(execFileStub);
  const spawnStub = ((_command: string, _args: readonly string[] | undefined, options: import('node:child_process').SpawnOptions | undefined) =>
    actualChildProcess.spawn(process.execPath, [childScript], (options ?? {}) as import('node:child_process').SpawnOptions)
  ) as unknown as typeof actualChildProcess.spawn;
  vi.mocked(interceptedSpawn).mockImplementation(spawnStub);

  await writeFile(baseConfig, `version: 3\nauthtoken: ${rootToken}\nagent:\n  authtoken: ${agentToken}\n`);
  await writePrivateFile(policyPath, 'synthetic policy fixture\n');
  await writeFile(childScript, `
import { setTimeout as delay } from 'node:timers/promises';
process.stdout.write('stdout-marker-start\\n');
process.stdout.write('authtoken: ${rootToken.slice(0, -3)}');
await delay(40);
process.stdout.write('${rootToken.slice(-3)}\\n');
process.stdout.write('agent.authtoken: ${agentToken.slice(0, -3)}');
await delay(40);
process.stderr.write('stderr-interleaving-marker\\n');
await delay(40);
process.stdout.write('${agentToken.slice(-3)}\\nstdout-marker-end\\n');
process.stderr.write('password: ${password}\\nstderr-marker-end\\n');
process.exitCode = 7;
`);

  const config: RemoteAccessConfig = {
    format: 1,
    publicHost: 'notara-synthetic.example.invalid',
    username: 'synthetic-remote-user',
    password,
    proxyPort: 57321,
    ngrokApiPort: apiPort,
    ngrokPath: 'synthetic-ngrok',
    localPort: 57320,
  };
  try {
    const failure = await startNgrokTunnel(config, policyPath, baseConfig, overlayPath, controllerLog).then(
      () => undefined,
      error => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toContain('ngrok exited before reporting the configured endpoint');
    expect(failure?.message).toContain(controllerLog);

    const log = await readFile(controllerLog, 'utf8');
    expect(log).toContain('ngrok diagnostics:');
    expect(log).toContain('stdout-marker-start');
    expect(log).toContain('stdout-marker-end');
    expect(log).toContain('stderr-interleaving-marker');
    expect(log).toContain('stderr-marker-end');
    expect(log).not.toContain(rootToken);
    expect(log).not.toContain(agentToken);
    expect(log).not.toContain(agentToken.slice(-3));
    expect(log).not.toContain(password);
    expect(log).not.toContain(`${config.username}:${password}`);
  } finally {
    vi.mocked(interceptedSpawn).mockReset();
    vi.mocked(interceptedExecFile).mockReset();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

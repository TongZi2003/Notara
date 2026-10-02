import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:net';
import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { securePrivatePath, writePrivateFile, type RemoteAccessConfig } from './remote-access-config.ts';

const execFileAsync = promisify(execFile);
const NGROK_TIMEOUT_MS = 30_000;

export interface NgrokTunnel {
  readonly publicUrl: string;
  stop(): Promise<void>;
  readonly exited: Promise<never>;
}

export function buildNgrokPolicy(config: Pick<RemoteAccessConfig, 'username' | 'password'>): string {
  const credential = `${config.username}:${config.password}`;
  return stringify({
    on_http_request: [{
      actions: [{
        type: 'basic-auth',
        config: { realm: 'Notara', credentials: [credential], enforce: true },
      }],
    }],
  });
}

export function buildNgrokConfigOverlay(apiPort: number): string {
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error('Invalid ngrok local API port.');
  return stringify({ version: 3, agent: { web_addr: `127.0.0.1:${apiPort}` } });
}

export function buildNgrokAuthtokenConfig(authtoken: string): string {
  if (typeof authtoken !== 'string' || !/^[\x21-\x7e]{1,1000}$/.test(authtoken) || authtoken.includes('${'))
    throw new Error('ngrok Authtoken must contain printable ASCII characters and no `${` expression marker.');
  return stringify({ version: 3, agent: { authtoken } });
}

/** ngrok config check reports the active source path without exposing its contents. */
export function parseNgrokConfigPath(output: string): string {
  const match = /^\s*Valid configuration file at\s+(.+?)\s*$/im.exec(output);
  const path = match?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!path) throw new Error('ngrok config check did not report the active config path. Run `ngrok config check` and confirm that an authtoken config is installed.');
  return resolve(path);
}

export async function assertNgrokReady(executable: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ['config', 'check'], { windowsHide: true, timeout: 8_000, maxBuffer: 24 * 1024 });
    return parseNgrokConfigPath(`${stdout}\n${stderr}`);
  } catch (error) {
    if (error instanceof Error && /did not report the active config path/.test(error.message)) throw error;
    const cause = error as NodeJS.ErrnoException & { stderr?: string; code?: string | number };
    if (cause.code === 'ENOENT') throw new Error(`Cannot find ngrok at "${executable}". Install ngrok or fix the configured path.`, { cause: error });
    throw new Error('ngrok is not configured for this Windows account. Add your ngrok authtoken with `ngrok config add-authtoken`, then retry.', { cause: error });
  }
}

export async function assertTcpPortAvailable(port: number, label: string): Promise<void> {
  const probe: Server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => resolve());
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' || (error as NodeJS.ErrnoException).code === 'EACCES')
      throw new Error(`${label} port ${port} is already in use or reserved. No ngrok tunnel was started.`, { cause: error });
    throw error;
  } finally { probe.close(); }
}

function ngrokEnvironment(): NodeJS.ProcessEnv {
  const keys = process.platform === 'win32'
    ? ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'NGROK_CONFIG']
    : ['PATH', 'HOME', 'TMPDIR', 'NGROK_CONFIG'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

function ngrokTargetMatches(value: unknown, port: number): boolean {
  if (typeof value !== 'string') return false;
  try {
    const target = value.includes('://') ? new URL(value) : new URL(`http://${value}`);
    return target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && Number(target.port || 80) === port;
  } catch { return value === String(port); }
}

async function readTunnels(apiPort: number): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/tunnels`, { signal: AbortSignal.timeout(1_500) });
  if (!response.ok) throw new Error(`ngrok local API returned HTTP ${response.status}.`);
  return response.json();
}

async function checkMergedConfig(executable: string, basePath: string, overlayPath: string): Promise<void> {
  try {
    await execFileAsync(executable, ['config', 'check', `--config=${basePath}`, `--config=${overlayPath}`], {
      windowsHide: true, timeout: 8_000, maxBuffer: 24 * 1024,
    });
  } catch (error) {
    throw new Error('ngrok rejected its private loopback API config overlay. No tunnel was started; inspect the ngrok installation and config version.', { cause: error });
  }
}

/**
 * Start ngrok after the authenticated proxy is listening. The generated
 * overlay only changes the admin API bind address; ngrok reads its authtoken
 * from either the private per-runtime config or the existing user config.
 */
export async function startNgrokTunnel(
  config: RemoteAccessConfig,
  policyPath: string,
  baseConfigPath: string,
  overlayPath: string,
  controllerLogPath: string,
): Promise<NgrokTunnel> {
  await assertTcpPortAvailable(config.ngrokApiPort, 'ngrok local API');
  const base = resolve(baseConfigPath);
  const overlay = resolve(overlayPath);
  if (base === overlay) throw new Error('The ngrok private overlay cannot replace the user config.');
  await securePrivatePath(policyPath);
  await writePrivateFile(overlay, buildNgrokConfigOverlay(config.ngrokApiPort));
  await checkMergedConfig(config.ngrokPath, base, overlay);

  const target = `http://127.0.0.1:${config.proxyPort}`;
  const args = [
    'http', target,
    `--url=https://${config.publicHost}`,
    `--traffic-policy-file=${policyPath}`,
    `--config=${base}`,
    `--config=${overlay}`,
    '--log=stdout',
  ];
  // ngrok can print configuration and connection details. Do not copy its raw
  // output into logs; in-memory or per-chunk redaction can leak split secrets.
  const child: ChildProcess = spawn(config.ngrokPath, args, {
    env: ngrokEnvironment(),
    stdio: 'ignore',
    windowsHide: true,
  });
  let stopping = false;
  let spawnError: Error | undefined;
  let exitResolve!: () => void;
  let exitReject!: (error: Error) => void;
  const exited = new Promise<never>((_, reject) => { exitReject = reject; });
  void exited.catch(() => undefined);
  const processExit = new Promise<void>(resolve => { exitResolve = resolve; });
  child.once('error', error => {
    spawnError = error;
    exitResolve();
    exitReject(new Error(`ngrok could not start: ${error.message}`, { cause: error }));
  });
  child.once('exit', (code, signal) => {
    exitResolve();
    if (!stopping) exitReject(new Error(`ngrok exited (code ${code ?? 'none'}, signal ${signal ?? 'none'}). See ${controllerLogPath}.`));
  });

  const expectedUrl = `https://${config.publicHost}`;
  const deadline = Date.now() + NGROK_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw new Error(`ngrok could not start. Check the ngrok path and configuration; see ${controllerLogPath}.`, { cause: spawnError });
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`ngrok exited before reporting the configured endpoint. See ${controllerLogPath}.`);
      try {
        const payload = await readTunnels(config.ngrokApiPort) as { tunnels?: unknown };
        const tunnels = Array.isArray(payload.tunnels) ? payload.tunnels : [];
        const found = tunnels.find((entry): entry is { public_url?: unknown; config?: { addr?: unknown } } => {
          if (!entry || typeof entry !== 'object') return false;
          const tunnel = entry as { public_url?: unknown; config?: { addr?: unknown } };
          return tunnel.public_url === expectedUrl && ngrokTargetMatches(tunnel.config?.addr, config.proxyPort);
        });
        if (found) {
          if (child.exitCode !== null || child.signalCode !== null) throw new Error(`ngrok exited while the endpoint was being verified. See ${controllerLogPath}.`);
          return {
            publicUrl: expectedUrl,
            exited,
            async stop() {
              if (stopping) { await processExit; return; }
              stopping = true;
              if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
              const timeout = new Promise<void>(resolve => setTimeout(resolve, 4_000));
              await Promise.race([processExit, timeout]);
              if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
              await processExit;
            },
          };
        }
      } catch (error) {
        if (error instanceof Error && /while the endpoint was being verified/.test(error.message)) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') { /* ngrok API is still starting */ }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`ngrok did not report the configured endpoint in ${NGROK_TIMEOUT_MS / 1000} seconds. Check the domain assignment, account plan, and ngrok logs; no credential-bearing output was saved.`);
  } catch (error) {
    stopping = true;
    if (child.exitCode === null && child.signalCode === null && !spawnError) child.kill('SIGTERM');
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 4_000));
    await Promise.race([processExit, timeout]);
    if (child.exitCode === null && child.signalCode === null && !spawnError) child.kill('SIGKILL');
    await processExit;
    throw error;
  }
}

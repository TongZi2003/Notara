import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFile, lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import lockfile from 'proper-lockfile';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { httpUrlPort, liveVaultUrl, validateVaultPort } from './vault-launcher-state.ts';
import { listenWebLoopback } from './listen-web-loopback.ts';
import { managedCode, superviseVault } from './vault-supervisor.ts';
import { assertPrivateDirectoryOutsideCheckout, defaultRemoteConfigPath, ensurePrivateDirectory, readRemoteConfig, securePrivatePath, validateRemoteConfig, writePrivateFile, writeRemoteConfig, type RemoteAccessConfig } from './remote-access-config.ts';
import { assertNgrokReady, buildNgrokPolicy, startNgrokTunnel, type NgrokTunnel } from './remote-ngrok.ts';
import { startRemoteProxy, type RemoteProxy } from './remote-access-proxy.ts';
import { acquireRemoteAccessLock } from './remote-access-lock.ts';
import { readyVaultHasStopped } from './remote-vault-health.ts';

type StartMode = 'all' | 'local' | 'remote-only';
type SupervisorMode = 'starting' | 'ready' | 'failed' | 'stopping';

interface ControllerState {
  format: 1;
  pid: number;
  startedAt: number;
  runtimeRoot: string;
  endpoint: string;
  token: string;
  phase: SupervisorMode;
  ownsVault: boolean;
  remoteActive: boolean;
  publicHost?: string;
  localPort?: number;
  lastError?: string;
}

interface PublicStatus {
  running: boolean;
  phase: SupervisorMode;
  ownsVault: boolean;
  runtimeRoot: string;
  remoteActive: boolean;
  localPort?: number;
  remoteUrl?: string;
  error?: string;
}

interface CliOptions { root: string; config: string; port?: number }

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultRuntimeRoot = (): string => join(homedir(), '.notara', 'vault-runtime');
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

function parseOptions(args: string[]): { options: CliOptions; rest: string[] } {
  let root = defaultRuntimeRoot();
  let config = defaultRemoteConfigPath();
  let port: number | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const value = args[i]!;
    if (value === '--root' && args[i + 1]) root = resolve(args[++i]!);
    else if (value === '--config' && args[i + 1]) config = resolve(args[++i]!);
    else if (value === '--port' && args[i + 1]) { port = Number(args[++i]); validateVaultPort(port); }
    else rest.push(value);
  }
  return { options: { root, config, ...(port !== undefined ? { port } : {}) }, rest };
}

function statePaths(configPath: string): { directory: string; state: string; lock: string; policy: string; overlay: string; log: string } {
  const config = resolve(configPath);
  const directory = dirname(config);
  const base = config.replace(/\.[^./\\]+$/, '');
  return {
    directory,
    state: `${base}.controller.json`,
    lock: `${base}.controller-lock`,
    policy: `${base}.ngrok-policy.yaml`,
    overlay: `${base}.ngrok-overlay.yml`,
    log: `${base}.log`,
  };
}

async function canonicalRuntimeRoot(path: string): Promise<string> {
  const requested = resolve(path);
  let cursor = requested;
  const missing: string[] = [];
  while (true) {
    try { return resolve(await realpath(cursor), ...missing.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) return requested;
      missing.push(basename(cursor));
      cursor = parent;
    }
  }
}

function sameRuntimeRoot(left: string, right: string): boolean {
  const a = resolve(left), b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function assertControllerRoot(state: ControllerState, requestedRoot: string): Promise<void> {
  const requested = await canonicalRuntimeRoot(requestedRoot);
  if (!sameRuntimeRoot(state.runtimeRoot, requested)) {
    throw new Error(`This remote controller already owns Vault runtime ${state.runtimeRoot}. Refusing to reuse or stop it for ${requested}; use the original --root or a separate private --config.`);
  }
}

async function logPrivate(path: string, message: string): Promise<void> {
  await ensurePrivateDirectory(dirname(path));
  await appendFile(path, `${new Date().toISOString()} ${message.replace(/[\r\n]+/g, ' ')}\n`, { mode: 0o600 });
  await securePrivatePath(path);
}

function statusOf(state: ControllerState): PublicStatus {
  return {
    running: state.phase === 'ready' || state.phase === 'starting',
    phase: state.phase,
    ownsVault: state.ownsVault,
    runtimeRoot: state.runtimeRoot,
    remoteActive: state.remoteActive,
    ...(state.localPort ? { localPort: state.localPort } : {}),
    ...(state.remoteActive && state.publicHost ? { remoteUrl: `https://${state.publicHost}/login` } : {}),
    ...(state.lastError ? { error: state.lastError } : {}),
  };
}

function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(body.length), 'cache-control': 'no-store' });
  response.end(body);
}

function secretMatches(value: string | undefined, token: string): boolean {
  if (!value) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readControllerState(path: string): Promise<ControllerState | undefined> {
  let source: string;
  try { source = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  let state: ControllerState;
  try { state = JSON.parse(source) as ControllerState; }
  catch (error) { throw new Error(`Remote controller state is damaged at ${path}; inspect it before deleting it.`, { cause: error }); }
  if (state?.format !== 1 || !Number.isInteger(state.pid) || state.pid < 1 || typeof state.runtimeRoot !== 'string' || !isAbsolute(state.runtimeRoot) || typeof state.endpoint !== 'string' ||
    typeof state.token !== 'string' || state.token.length < 40 || !Number.isInteger(state.startedAt))
    throw new Error(`Remote controller state is invalid at ${path}; inspect it before deleting it.`);
  try { await securePrivatePath(path); }
  catch (error) {
    // Shutdown may remove the volatile record between reading it and the ACL
    // check. A vanished file is not a permission failure; every other error
    // still fails closed, including replacement by another present record.
    const present = await lstat(path).then(() => true, (failure: NodeJS.ErrnoException) => {
      if (failure.code === 'ENOENT') return false;
      throw failure;
    });
    if (!present) return undefined;
    throw error;
  }
  return state;
}

async function processAlive(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    throw error;
  }
}

function controllerUrl(state: ControllerState, suffix: string): URL {
  let endpoint: URL;
  try { endpoint = new URL(state.endpoint); } catch (error) { throw new Error('Invalid remote controller address.', { cause: error }); }
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.username || endpoint.password || endpoint.pathname !== '/')
    throw new Error('Invalid remote controller address.');
  endpoint.pathname = suffix;
  return endpoint;
}

async function controllerRequest(state: ControllerState, method: 'GET' | 'POST', suffix: string, timeoutMs = 45_000): Promise<{ status: number; value?: PublicStatus; message?: string }> {
  const response = await fetch(controllerUrl(state, suffix), {
    method,
    headers: { authorization: `Bearer ${state.token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const value = await response.json().catch(() => undefined) as (PublicStatus & { message?: string }) | undefined;
  return { status: response.status, ...(value ? { value, message: value.message } : {}) };
}

async function discardDeadController(paths: ReturnType<typeof statePaths>, state: ControllerState): Promise<boolean> {
  if (await processAlive(state.pid)) return false;
  await rm(paths.state, { force: true });
  return true;
}

// The detached process must load its modules before publishing controller
// state. Cold Windows Release installs need time for that and the first Host.
async function waitForController(paths: ReturnType<typeof statePaths>, requestedRoot: string, timeoutMs = 120_000): Promise<{ state: ControllerState; status: PublicStatus }> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    const state = await readControllerState(paths.state).catch(error => { lastError = errorText(error); return undefined; });
    if (state) {
      await assertControllerRoot(state, requestedRoot);
      const reply = await controllerRequest(state, 'GET', '/v1/status').catch(error => { lastError = errorText(error); return undefined; });
      if (reply?.status === 200 && reply.value) {
        if (reply.value.phase === 'failed') throw new Error(reply.value.error ?? 'Notara remote startup failed.');
        if (reply.value.phase === 'ready') return { state, status: reply.value };
      } else if (reply?.status === 404) {
        if (await discardDeadController(paths, state)) lastError = 'A previous remote controller exited during startup.';
      } else if (reply && reply.status !== 401) lastError = reply.message ?? `Controller returned HTTP ${reply.status}.`;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(lastError ? `Remote startup timed out: ${lastError}` : `Remote startup did not become ready within ${timeoutMs / 1000} seconds. See ${paths.log}.`);
}

async function waitForControllerShutdown(paths: ReturnType<typeof statePaths>, options: CliOptions, previous: ControllerState): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const current = await readControllerState(paths.state);
    if (current) {
      await assertControllerRoot(current, options.root);
      // Another Start may already have recovered the same runtime. Re-read it
      // through the normal start path instead of stopping that new controller.
      if (current.pid !== previous.pid || current.startedAt !== previous.startedAt) return;
      if (!(await processAlive(current.pid))) await discardDeadController(paths, current);
    } else {
      const locked = await lockfile.check(paths.lock, { stale: 10_000 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      });
      if (!locked) return;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 150));
  }
  throw new Error(`The previous Notara controller did not finish cleaning up. See ${paths.log}.`);
}

async function startBackground(mode: StartMode, options: CliOptions): Promise<void> {
  const paths = statePaths(options.config);
  await assertPrivateDirectoryOutsideCheckout(paths.directory);
  let existing = await readControllerState(paths.state);
  if (existing) {
    await assertControllerRoot(existing, options.root);
    const alive = await processAlive(existing.pid);
    const reply = alive ? await controllerRequest(existing, 'GET', '/v1/status').catch(() => undefined) : undefined;
    if (reply?.status === 200 && reply.value) {
      if (reply.value.phase === 'failed' || reply.value.phase === 'stopping') {
        // Cleanup owns the old worker and its locks. Never bypass it by deleting
        // a live controller record or launching another copy alongside it.
        await controllerRequest(existing, 'POST', '/v1/stop').catch(() => undefined);
        await waitForControllerShutdown(paths, options, existing);
        return startBackground(mode, options);
      }
      if (mode === 'all' || mode === 'remote-only') {
        const updated = await controllerRequest(existing, 'POST', '/v1/remote/start');
        if (updated.status !== 200) throw new Error(updated.message ?? 'Could not start the remote tunnel.');
      }
      const current = await controllerRequest(existing, 'GET', '/v1/status');
      if (current.status === 200 && current.value?.phase === 'ready') {
        printStarted(current.value);
        return;
      }
      if (current.value?.phase === 'starting') {
        const ready = await waitForController(paths, options.root);
        printStarted(ready.status);
        return;
      }
      throw new Error(current.message ?? 'The remote controller is not ready.');
    }
    if (alive) throw new Error(`Remote controller process ${existing.pid} is alive but did not answer its private control request. Refusing to start a second copy; inspect ${paths.state}.`);
    await discardDeadController(paths, existing);
    existing = undefined;
  }

  // A lock directory can outlive a crashed controller. Use the lock library's
  // heartbeat/staleness rules instead of treating any directory as a live lock.
  const lockIsActive = await lockfile.check(paths.lock, { stale: 10_000 }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  });
  if (lockIsActive) {
    try {
      const ready = await waitForController(paths, options.root, 15_000);
      if (mode === 'all' || mode === 'remote-only') {
        const updated = await controllerRequest(ready.state, 'POST', '/v1/remote/start');
        if (updated.status !== 200) throw new Error(updated.message ?? 'Could not start the remote tunnel.');
      }
      const current = await controllerRequest(ready.state, 'GET', '/v1/status');
      if (current.status === 200 && current.value) { printStarted(current.value); return; }
    } catch (error) { throw new Error(`Another Vault control operation is starting or stopping. ${errorText(error)}`, { cause: error }); }
  }

  const scriptPath = fileURLToPath(import.meta.url);
  const logHandle = await open(paths.log, 'a', 0o600);
  await securePrivatePath(paths.log);
  let child;
  try {
    child = spawn(process.execPath, ['--import', 'tsx', scriptPath, '__supervisor', mode, '--root', options.root, '--config', options.config,
      ...(options.port !== undefined ? ['--port', String(options.port)] : [])], {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore', logHandle.fd, logHandle.fd],
      windowsHide: true,
    });
  } finally { await logHandle.close(); }
  child.unref();
  child.once('error', error => { void logPrivate(paths.log, `Could not spawn the remote controller: ${error.message}`); });
  const ready = await waitForController(paths, options.root);
  printStarted(ready.status);
}

function printStarted(status: PublicStatus): void {
  if (status.phase !== 'ready') throw new Error(status.error ?? 'Notara control process is not ready.');
  if (status.remoteActive) console.log(`Notara remote access is ready at ${status.remoteUrl}. Use the separately configured remote username and password, then complete Notara sign-in on this computer.`);
  else console.log(`Notara is running locally at http://127.0.0.1:${status.localPort ?? 57093}/.`);
  if (status.error) {
    console.error(`Remote access could not start; the local Vault remains available: ${status.error}`);
    process.exitCode = 1;
  }
  if (!status.ownsVault) console.log('This controller attached to a Vault started elsewhere; stopping remote access will leave that Vault running.');
}

async function commandExistingController(command: 'stop' | 'remote-stop' | 'status', options: CliOptions): Promise<void> {
  const paths = statePaths(options.config);
  await assertPrivateDirectoryOutsideCheckout(paths.directory);
  const state = await readControllerState(paths.state);
  if (!state) {
    if (command === 'status') { console.log('Notara access controller is not running.'); return; }
    console.log(command === 'remote-stop' ? 'No managed remote tunnel is running.' : 'No managed Notara controller is running.');
    return;
  }
  await assertControllerRoot(state, options.root);
  if (!(await processAlive(state.pid))) {
    await discardDeadController(paths, state);
    if (command === 'status') { console.log('Notara access controller is stopped.'); return; }
    console.log('A stale Notara controller record was removed; no unrelated processes were stopped.');
    return;
  }
  if (command === 'remote-stop') {
    const current = await controllerRequest(state, 'GET', '/v1/status').catch(() => undefined);
    if (current?.status === 200 && current.value?.phase === 'ready' && !current.value.remoteActive) {
      console.log('No managed remote tunnel is running.');
      return;
    }
  }
  const endpoint = command === 'status' ? '/v1/status' : command === 'stop' ? '/v1/stop' : '/v1/remote/stop';
  const reply = await controllerRequest(state, command === 'status' ? 'GET' : 'POST', endpoint);
  if (reply.status !== 200 && reply.status !== 202) throw new Error(reply.message ?? `Notara controller returned HTTP ${reply.status}.`);
  if (command === 'status') {
    const current = reply.value!;
    console.log(current.running
      ? `Notara controller is ${current.phase}; Vault ownership=${current.ownsVault ? 'managed' : 'external'}; remote access=${current.remoteActive ? current.remoteUrl : 'stopped'}${current.error ? `; remote error=${current.error}` : ''}.`
      : `Notara controller is ${current.phase}${current.error ? `: ${current.error}` : ''}.`);
    return;
  }
  if (command === 'remote-stop') {
    console.log('Remote tunnel shutdown requested. The local Vault will keep running.');
    const deadline = Date.now() + 20_000;
    let stopped = false;
    while (Date.now() < deadline) {
      const current = await readControllerState(paths.state).catch(() => undefined);
      if (!current) { stopped = true; break; }
      const status = await controllerRequest(current, 'GET', '/v1/status').catch(() => undefined);
      if (status?.value?.phase === 'ready' && !status.value.remoteActive) { stopped = true; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (!stopped) throw new Error(`Remote tunnel did not finish shutting down. See ${paths.log}.`);
    return;
  }
  console.log('Notara shutdown requested.');
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const current = await readControllerState(paths.state).catch(() => undefined);
    if (!current) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Notara did not finish shutting down. See ${paths.log}.`);
}

async function askHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') throw new Error('Remote password setup needs an interactive terminal.');
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return await new Promise<string>((resolve, reject) => {
    let value = '';
    const restore = (): void => { stdin.off('data', onData); stdin.setRawMode(false); stdout.write('\n'); };
    const onData = (chunk: Buffer | string): void => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') { restore(); reject(new Error('Password setup cancelled.')); return; }
        if (character === '\r' || character === '\n') { restore(); resolve(value); return; }
        if (character === '\u0008' || character === '\u007f') {
          if (value.length) { value = value.slice(0, -1); stdout.write('\b \b'); }
          continue;
        }
        if (character >= '!' && character <= '~' && value.length < 128) { value += character; stdout.write('*'); }
      }
    };
    stdin.on('data', onData);
  });
}

async function configure(options: CliOptions): Promise<void> {
  const reader = createInterface({ input: stdin, output: stdout });
  let ngrokPath = 'ngrok';
  let publicHost = '';
  let username = '';
  try {
    ngrokPath = (await reader.question('ngrok executable path (Enter for ngrok on PATH): ')).trim() || 'ngrok';
    await assertNgrokReady(ngrokPath);
    publicHost = (await reader.question('ngrok assigned hostname (for example study.ngrok-free.app, no scheme): ')).trim().toLowerCase();
    username = (await reader.question('Remote access username: ')).trim();
  } finally { reader.close(); }
  const password = await askHidden('Remote access password (12–128 printable characters): ');
  const confirm = await askHidden('Repeat password: ');
  if (password !== confirm) throw new Error('The passwords did not match.');
  const portReader = createInterface({ input: stdin, output: stdout });
  try {
    const readPort = async (label: string, fallback: number): Promise<number> => {
      const answer = (await portReader.question(`${label} [${fallback}]: `)).trim();
      return answer ? Number(answer) : fallback;
    };
    const config = {
      format: 1 as const,
      publicHost,
      username,
      password,
      ngrokPath,
      localPort: await readPort('Vault loopback port', 57093),
      proxyPort: await readPort('Authenticated proxy loopback port', 57094),
      ngrokApiPort: await readPort('ngrok local API port', 4040),
    };
    validateVaultPort(config.localPort);
    const valid = validateRemoteConfig(config);
    await writeRemoteConfig(valid, options.config);
    console.log(`Remote settings saved outside the checkout at ${options.config}. The file is private to this Windows account.`);
  } finally { portReader.close(); }
}

async function saveState(path: string, state: ControllerState): Promise<void> {
  await writePrivateFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

async function listenControlServer(server: Server): Promise<number> {
  return listenWebLoopback(server);
}

async function runSupervisor(mode: StartMode, options: CliOptions): Promise<void> {
  let initialConfig: RemoteAccessConfig | undefined;
  if (mode !== 'local') {
    // Keep local Vault startup independent of remote configuration errors.
    // The remote transition reports a missing/invalid setup after loopback is ready.
    try { initialConfig = await readRemoteConfig(options.config); }
    catch { initialConfig = undefined; }
  }
  const paths = statePaths(options.config);
  await assertPrivateDirectoryOutsideCheckout(paths.directory);
  await mkdir(dirname(paths.lock), { recursive: true }).catch(() => undefined);
  const lockTarget = paths.lock;
  const lockFile = await open(lockTarget, 'a', 0o600);
  await lockFile.close();
  await securePrivatePath(lockTarget);
  let releaseLock: (() => Promise<void>) | undefined;
  try { releaseLock = await lockfile.lock(lockTarget, { retries: 0, stale: 10_000, update: 5_000 }); }
  catch (error) { throw new Error('Another Notara access controller is already starting or running.', { cause: error }); }

  let runtime: Awaited<ReturnType<typeof superviseVault>> | undefined;
  let ownsVault = false;
  let proxy: RemoteProxy | undefined;
  let tunnel: NgrokTunnel | undefined;
  let releaseRemoteOwnership: (() => Promise<void>) | undefined;
  let remoteConfig: RemoteAccessConfig | undefined = initialConfig;
  let startupResolve!: () => void;
  let startupReject!: (error: unknown) => void;
  const startup: Promise<void> = new Promise<void>((resolve, reject) => { startupResolve = resolve; startupReject = reject; });
  let transition: Promise<void> = Promise.resolve();
  let stopping = false;
  let shutdownTask: Promise<void> | undefined;
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  let healthProbe: Promise<unknown> | undefined;
  const controllerToken = randomBytes(32).toString('base64url');
  const startedAt = Date.now();
  let state: ControllerState = {
    format: 1,
    pid: process.pid,
    startedAt,
    runtimeRoot: await canonicalRuntimeRoot(options.root),
    endpoint: '',
    token: controllerToken,
    phase: 'starting',
    ownsVault: false,
    remoteActive: false,
  };
  // A successful HTTP status must describe state that has finished its private
  // atomic write. In particular, Start must not succeed while ready is still
  // being saved (and may yet fail on a Windows file-sharing violation).
  let publishedStatus = statusOf(state);

  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = transition.then(action, action);
    transition = result.then(() => undefined, () => undefined);
    return result;
  };
  const publishState = async (phase = state.phase): Promise<void> => {
    state = { ...state, phase, ownsVault, remoteActive: !!tunnel && !!proxy,
      ...(remoteConfig ? { publicHost: remoteConfig.publicHost, localPort: remoteConfig.localPort } : {}) };
    if (!state.remoteActive) { delete state.publicHost; }
    const nextStatus = statusOf(state);
    await saveState(paths.state, state);
    publishedStatus = nextStatus;
  };
  const startRemote = async (): Promise<void> => {
    if (stopping) throw new Error('Notara is already shutting down.');
    if (tunnel && proxy) return;
    const config = remoteConfig ?? await readRemoteConfig(options.config);
    remoteConfig = config;
    const login = await liveVaultUrl(options.root);
    if (!login) throw new Error('No verified local Notara service is running. Start `npm run vault:local:start` first.');
    if (httpUrlPort(new URL(login)) !== config.localPort) throw new Error(`Remote settings expect Vault port ${config.localPort}, but the running Vault uses ${httpUrlPort(new URL(login))}. Update the remote configuration.`);
    releaseRemoteOwnership = await acquireRemoteAccessLock(options.root);
    try {
      const ngrokConfigPath = await assertNgrokReady(config.ngrokPath);
      await writePrivateFile(paths.policy, buildNgrokPolicy(config));
      proxy = await startRemoteProxy({
        localPort: config.localPort,
        proxyPort: config.proxyPort,
        publicHost: config.publicHost,
        username: config.username,
        password: config.password,
        getLoginUrl: () => liveVaultUrl(options.root),
      });
      // The tunnel starts only after the proxy is listening and requires the same account credentials.
      tunnel = await startNgrokTunnel(config, paths.policy, ngrokConfigPath, paths.overlay, paths.log);
      const managedTunnel = tunnel;
      void managedTunnel.exited.catch(error => {
        if (stopping || tunnel !== managedTunnel) return;
        void logPrivate(paths.log, `ngrok stopped unexpectedly: ${errorText(error)}`);
        void serial(async () => { await stopRemote(); state = { ...state, lastError: errorText(error) }; await publishState('ready'); })
          .catch(cleanupError => logPrivate(paths.log, `Remote cleanup failed: ${errorText(cleanupError)}`));
      });
    } catch (error) {
      await stopRemote().catch(() => undefined);
      throw error;
    }
    if (stopping) { await stopRemote(); throw new Error('Remote startup was cancelled.'); }
    await logPrivate(paths.log, `Remote access ready for ${config.publicHost}.`);
  };
  const stopRemote = async (): Promise<void> => {
    const currentTunnel = tunnel;
    const currentProxy = proxy;
    const errors: unknown[] = [];
    if (currentTunnel) {
      try { await currentTunnel.stop(); tunnel = undefined; }
      catch (error) { errors.push(error); }
    }
    if (currentProxy) {
      try { await currentProxy.close(); proxy = undefined; }
      catch (error) { errors.push(error); }
    }
    if (!tunnel && !proxy) {
      await rm(paths.policy, { force: true });
      await rm(paths.overlay, { force: true });
      if (releaseRemoteOwnership) {
        try { await releaseRemoteOwnership(); releaseRemoteOwnership = undefined; }
        catch (error) { errors.push(error); }
      }
    }
    if (remoteConfig) await logPrivate(paths.log, 'Remote access stopped.');
    if (errors.length) throw new AggregateError(errors, 'Remote access did not stop cleanly.');
  };
  const beginShutdown = (phase: 'stopping' | 'failed' = 'stopping'): Promise<void> => {
    if (shutdownTask) return shutdownTask;
    stopping = true;
    if (healthTimer) clearInterval(healthTimer);
    state = { ...state, phase };
    const publishShutdown = serial(async () => {
      await startup.catch(() => undefined);
      // Publish only after any pending state write has settled. Leaving the
      // record until all resources and the lock are released gates a new Start.
      await publishState(phase);
    });
    shutdownTask = (async () => {
      const errors: unknown[] = [];
      try { await publishShutdown; } catch (error) { errors.push(error); }
      // A failed remote/state cleanup must not prevent an attempt to stop the
      // owned worker. Keep ownership evidence if any cleanup remains uncertain.
      try { await stopRemote(); } catch (error) { errors.push(error); }
      if (runtime && ownsVault) {
        try { await runtime.stop(); } catch (error) { errors.push(error); }
      }
      try { await logPrivate(paths.log, errors.length ? 'Notara shutdown has unfinished cleanup.' : ownsVault ? 'Notara and remote access stopped.' : 'Remote access stopped; the externally started Vault remains running.'); }
      catch (error) { errors.push(error); }
      if (errors.length) {
        state = { ...state, lastError: 'Notara shutdown did not finish cleanly. Inspect the private controller log before restarting.' };
        try { await publishState('failed'); } catch (error) { errors.push(error); }
        throw new AggregateError(errors, 'Notara shutdown did not stop all resources cleanly.');
      }
      await new Promise<void>(resolveClose => {
        controlServer.close(() => resolveClose());
        controlServer.closeIdleConnections();
      });
      await releaseLock?.();
      await rm(paths.state, { force: true });
    })();
    const currentShutdown = shutdownTask;
    void currentShutdown.catch(async error => {
      // Keep failed ownership closed, but an explicit Stop can retry a
      // transient cleanup error. A logging failure must not reject this handler.
      if (shutdownTask === currentShutdown) shutdownTask = undefined;
      try { await logPrivate(paths.log, `Shutdown failed: ${errorText(error)}`); } catch { /* Preserve the failed record and lock. */ }
    });
    return currentShutdown;
  };
  const refreshStatus = async (): Promise<PublicStatus> => {
    if (await readyVaultHasStopped(options.root, () => ({
      phase: stopping ? 'stopping' : state.phase,
      updating: runtime?.controller.status().phase === 'restarting',
    }))) {
      state = { ...state, lastError: 'The local Vault stopped unexpectedly. Start Notara again to recover.' };
      await publishState('failed');
      // Do not await server shutdown from a status request: close() also waits
      // for this response. The serialized action returns before cleanup starts.
      void beginShutdown('failed');
    }
    if (stopping && publishedStatus.running) throw new Error('Notara is shutting down; its previous ready status is no longer valid.');
    return publishedStatus;
  };
  const controlServer = createServer((request: IncomingMessage, response: ServerResponse) => {
    const header = request.headers.authorization;
    if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::ffff:127.0.0.1') {
      jsonResponse(response, 403, { message: 'Control requests must use loopback.' }); request.resume(); return;
    }
    if (!secretMatches(typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined, controllerToken)) {
      jsonResponse(response, 401, { message: 'Unauthorized.' }); request.resume(); return;
    }
    request.resume();
    if (request.method === 'GET' && request.url === '/v1/status') {
      void serial(refreshStatus).then(value => jsonResponse(response, 200, value), error => jsonResponse(response, 503, { message: errorText(error) }));
      return;
    }
    if (stopping && request.url !== '/v1/stop') { jsonResponse(response, 409, { message: 'Notara is already shutting down.' }); return; }
    if (request.method === 'POST' && request.url === '/v1/remote/start') {
      void serial(async () => {
        await startup;
        try {
          await startRemote();
          delete state.lastError;
          await publishState('ready');
        } catch (error) {
          state = { ...state, phase: state.localPort ? 'ready' : 'failed', lastError: errorText(error) };
          await publishState(state.phase);
          throw error;
        }
      }).then(() => jsonResponse(response, 200, statusOf(state)), error => jsonResponse(response, 409, { message: errorText(error) }));
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/remote/stop') {
      void serial(async () => { await startup.catch(() => undefined); await stopRemote(); delete state.lastError; await publishState('ready'); })
        .then(() => jsonResponse(response, 200, statusOf(state)), error => jsonResponse(response, 500, { message: errorText(error) }));
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/stop') {
      void beginShutdown();
      jsonResponse(response, 202, { message: 'Stopping.' });
      return;
    }
    jsonResponse(response, 404, { message: 'Not found.' });
  });

  const controlPort = await listenControlServer(controlServer);
    state = { ...state, endpoint: `http://127.0.0.1:${controlPort}/`, ...(remoteConfig ? { localPort: remoteConfig.localPort } : {}) };
  await publishState('starting');
  await logPrivate(paths.log, `Controller started in ${mode} mode.`);
  healthTimer = setInterval(() => {
    if (healthProbe || stopping || state.phase !== 'ready') return;
    // Keep at most one probe queued/running, and refuse automatic replacement
    // when liveness cannot be verified (for example, an I/O or auth error).
    healthProbe = serial(refreshStatus).catch(() => undefined).finally(() => { healthProbe = undefined; });
  }, 1000);
  healthTimer.unref();

  const startupTask = (async () => {
    try {
      if (mode !== 'remote-only') {
        const existingLogin = await liveVaultUrl(options.root);
        if (existingLogin) {
          ownsVault = false;
          state = { ...state, localPort: httpUrlPort(new URL(existingLogin)) };
          await logPrivate(paths.log, 'Attached to an already running local Vault.');
        } else {
          // Match `npm run vault`: use the selected managed code snapshot and
          // keep its update controller/bridge in the same owned lifecycle.
          const code = await managedCode(options.root) ?? projectRoot;
          runtime = await superviseVault(options.root, code, mode === 'local' ? options.port : remoteConfig?.localPort);
          ownsVault = true;
          state = { ...state, localPort: httpUrlPort(new URL(runtime.authUrl)) };
          await logPrivate(paths.log, 'Local Vault became ready.');
        }
        if (stopping) return;
      }
      if (mode === 'all') {
        await startRemote();
        if (stopping) return;
      } else if (mode === 'remote-only') {
        await startRemote();
        if (stopping) return;
      }
      state = { ...state, phase: 'ready', ownsVault, remoteActive: !!tunnel && !!proxy };
      await publishState('ready');
    } catch (error) {
      if (mode === 'all' && state.localPort && await liveVaultUrl(options.root).catch(() => undefined)) {
        await stopRemote().catch(cleanupError => logPrivate(paths.log, `Remote startup cleanup failed: ${errorText(cleanupError)}`));
        state = { ...state, phase: 'ready', lastError: errorText(error) };
        await publishState('ready');
        await logPrivate(paths.log, `Remote startup failed; local Vault remains available: ${errorText(error)}`);
        return;
      }
      state = { ...state, phase: 'failed', lastError: errorText(error) };
      await publishState('failed');
      await logPrivate(paths.log, `Startup failed: ${errorText(error)}`);
      throw error;
    }
  })();
  startupTask.then(startupResolve, startupReject);

  startup.catch(() => { void beginShutdown('failed'); });

  const stopOnSignal = (): void => { void beginShutdown(); };
  process.once('SIGINT', stopOnSignal);
  process.once('SIGTERM', stopOnSignal);
  await startup;
  await new Promise<void>(resolve => {
    const poll = setInterval(() => {
      if (shutdownTask) { clearInterval(poll); void shutdownTask.then(() => resolve(), () => resolve()); }
    }, 100);
    poll.unref();
  });
}

async function main(): Promise<void> {
  const { options, rest } = parseOptions(process.argv.slice(2));
  const command = rest[0];
  if (command === '__supervisor') {
    const mode = rest[1];
    if (mode !== 'all' && mode !== 'local' && mode !== 'remote-only') throw new Error('Invalid internal controller mode.');
    await runSupervisor(mode, options);
    return;
  }
  if (options.port !== undefined && command !== 'local-start') throw new Error('--port can only be used with local-start.');
  if (command === 'configure') { await configure(options); return; }
  if (command === 'start') { await startBackground('all', options); return; }
  if (command === 'local-start') { await startBackground('local', options); return; }
  if (command === 'remote-start') { await startBackground('remote-only', options); return; }
  if (command === 'stop') { await commandExistingController('stop', options); return; }
  if (command === 'remote-stop') { await commandExistingController('remote-stop', options); return; }
  if (command === 'status') { await commandExistingController('status', options); return; }
  throw new Error('Usage: remote-vault.ts <configure|start|local-start|remote-start|stop|remote-stop|status> [--root <path>] [--config <path>] [--port <port for local-start>]');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(errorText(error)); process.exitCode = 1; });
}

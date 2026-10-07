import { readFile, realpath, rm } from 'node:fs/promises';
import { httpUrlPort } from '../examples/native-vault/http-port.js';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import {
  assertPrivatePathOutsideCheckout,
  securePrivatePath,
  validateRemoteConfig,
  writePrivateFile,
  type RemoteAccessConfig,
} from './remote-access-config.ts';
import { acquireRemoteAccessLock } from './remote-access-lock.ts';
import { startRemoteProxy, type RemoteProxy, type RemoteProxyOptions } from './remote-access-proxy.ts';
import {
  assertNgrokReady,
  buildNgrokAuthtokenConfig,
  buildNgrokPolicy,
  startNgrokTunnel,
  type NgrokTunnel,
} from './remote-ngrok.ts';

export type RemoteSettingsCode =
  | 'remote_input_invalid'
  | 'remote_configuration_invalid'
  | 'remote_configuration_required'
  | 'remote_ngrok_missing'
  | 'remote_ngrok_unconfigured'
  | 'remote_busy'
  | 'remote_start_failed'
  | 'remote_stop_failed'
  | 'remote_save_failed'
  | 'remote_unsupported';

export interface RemoteSettingsInput {
  publicHost?: unknown;
  username?: unknown;
  password?: unknown;
  authtoken?: unknown;
  ngrokPath?: unknown;
  proxyPort?: unknown;
  ngrokApiPort?: unknown;
}

export interface PublicRemoteSettings {
  available: boolean;
  phase: 'disabled' | 'starting' | 'enabled' | 'stopping' | 'error' | 'unsupported';
  configured: boolean;
  config: {
    publicHost?: string;
    username?: string;
    ngrokPath?: string;
    proxyPort?: number;
    ngrokApiPort?: number;
  };
  hasPassword: boolean;
  hasAuthtoken: boolean;
  canDisable: boolean;
  code?: RemoteSettingsCode;
  url?: string;
}

export interface RemoteAccessDependencies {
  assertNgrokReady?: typeof assertNgrokReady;
  startProxy?: (options: RemoteProxyOptions) => Promise<RemoteProxy>;
  startTunnel?: (
    config: RemoteAccessConfig,
    policyPath: string,
    baseConfigPath: string,
    overlayPath: string,
    controllerLogPath: string,
  ) => Promise<NgrokTunnel>;
}

export interface RemoteAccessService {
  status(input?: unknown): Promise<PublicRemoteSettings>;
  save(input?: unknown): Promise<PublicRemoteSettings>;
  enable(input?: unknown): Promise<PublicRemoteSettings>;
  disable(input?: unknown): Promise<PublicRemoteSettings>;
  close(): Promise<void>;
}

interface StoredSettings {
  format: 1;
  publicHost: string;
  username: string;
  password: string;
  ngrokPath: string;
  proxyPort: number;
  ngrokApiPort: number;
}

const allowedFields = new Set(['publicHost', 'username', 'password', 'authtoken', 'ngrokPath', 'proxyPort', 'ngrokApiPort']);
const throwCode = (code: RemoteSettingsCode): never => { throw new Error(code); };

function parseInput(value: unknown): RemoteSettingsInput {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return throwCode('remote_input_invalid');
  const input = value as RemoteSettingsInput;
  if (Object.keys(input).some(key => !allowedFields.has(key))) return throwCode('remote_input_invalid');
  for (const [key, item] of Object.entries(input)) {
    if (key.endsWith('Port')) {
      if (!Number.isInteger(item) || Number(item) < 1 || Number(item) > 65535) return throwCode('remote_input_invalid');
    } else if (typeof item !== 'string' || item.length > 1000 || /[\r\n\0]/.test(item)) return throwCode('remote_input_invalid');
  }
  return input;
}

function validateStored(value: unknown): StoredSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return throwCode('remote_configuration_invalid');
  const input = value as Partial<StoredSettings>;
  if (input.format !== 1) return throwCode('remote_configuration_invalid');
  const candidatePort = [1, 2, 3].find(port => port !== input.proxyPort && port !== input.ngrokApiPort)!;
  try {
    const config = validateRemoteConfig({ ...input, format: 1, localPort: candidatePort });
    return {
      format: 1,
      publicHost: config.publicHost,
      username: config.username,
      password: config.password,
      ngrokPath: config.ngrokPath,
      proxyPort: config.proxyPort,
      ngrokApiPort: config.ngrokApiPort,
    };
  } catch (error) {
    throw new Error('remote_configuration_invalid', { cause: error });
  }
}

function localPortFromUrl(value: string | undefined): number | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const port = httpUrlPort(url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535 ||
      url.username || url.password || url.pathname !== '/' || !url.searchParams.has('token') || url.hash) return undefined;
    return port;
  } catch { return undefined; }
}

function errorCode(error: unknown): RemoteSettingsCode {
  if (error instanceof Error) {
    if (allowedCode(error.message)) return error.message;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || /Cannot find ngrok/.test(error.message)) return 'remote_ngrok_missing';
    if (/not configured|authtoken config|authtoken/i.test(error.message)) return 'remote_ngrok_unconfigured';
    if (/configuration|publicHost|username|password|port/i.test(error.message)) return 'remote_configuration_invalid';
  }
  return 'remote_start_failed';
}

function allowedCode(value: string): value is RemoteSettingsCode {
  return new Set<RemoteSettingsCode>([
    'remote_input_invalid', 'remote_configuration_invalid', 'remote_configuration_required', 'remote_ngrok_missing',
    'remote_ngrok_unconfigured', 'remote_busy', 'remote_start_failed', 'remote_stop_failed', 'remote_save_failed', 'remote_unsupported',
  ]).has(value as RemoteSettingsCode);
}

async function readPrivateText(path: string): Promise<string | undefined> {
  assertPrivatePathOutsideCheckout(path);
  let canonical: string;
  try { canonical = await realpath(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  assertPrivatePathOutsideCheckout(canonical);
  await securePrivatePath(canonical);
  return readFile(canonical, 'utf8');
}

export function createRemoteAccessService(
  runtimeRoot: string,
  getLoginUrl: () => Promise<string | undefined> | string | undefined,
  dependencies: RemoteAccessDependencies = {},
): RemoteAccessService {
  const directory = join(resolve(runtimeRoot), '.notara', 'remote-access');
  const settingsPath = join(directory, 'settings.json');
  const authtokenPath = join(directory, 'ngrok.yml');
  const policyPath = join(directory, 'policy.yml');
  const overlayPath = join(directory, 'overlay.yml');
  const controllerLogPath = join(directory, 'ngrok.log');
  const checkNgrok = dependencies.assertNgrokReady ?? assertNgrokReady;
  const launchProxy = dependencies.startProxy ?? startRemoteProxy;
  const launchTunnel = dependencies.startTunnel ?? startNgrokTunnel;

  let phase: PublicRemoteSettings['phase'] = 'disabled';
  let code: RemoteSettingsCode | undefined;
  let url: string | undefined;
  let proxy: RemoteProxy | undefined;
  let tunnel: NgrokTunnel | undefined;
  let releaseLock: (() => Promise<void>) | undefined;
  let transition = false;
  let cacheLoaded = false;
  let cachedSettings: StoredSettings | undefined;
  let cachedHasAuthtoken = false;
  let cachedFailure: RemoteSettingsCode | undefined;

  const readSettings = async (): Promise<StoredSettings | undefined> => {
    const raw = await readPrivateText(settingsPath);
    if (raw === undefined) return undefined;
    try { return validateStored(JSON.parse(raw)); }
    catch (error) { throw new Error('remote_configuration_invalid', { cause: error }); }
  };

  const hasPrivateAuthtoken = async (): Promise<boolean> => {
    const raw = await readPrivateText(authtokenPath);
    if (raw === undefined) return false;
    return validAuthtokenConfig(raw);
  };

  const validAuthtokenConfig = (raw: string): boolean => {
    try {
      const value = parse(raw) as { version?: unknown; agent?: { authtoken?: unknown } };
      return value?.version === 3 && typeof value.agent?.authtoken === 'string' && value.agent.authtoken.length > 0;
    } catch { return false; }
  };

  const loadCache = async (): Promise<void> => {
    if (cacheLoaded) return;
    try {
      cachedSettings = await readSettings();
      cachedHasAuthtoken = await hasPrivateAuthtoken();
    } catch (error) {
      cachedFailure = error instanceof Error && error.message === 'remote_configuration_invalid' ? 'remote_configuration_invalid' : 'remote_save_failed';
    }
    cacheLoaded = true;
  };

  const status = async (): Promise<PublicRemoteSettings> => {
    await loadCache();
    const settings = cachedSettings;
    const failure = cachedFailure;
    const currentCode = failure ?? code;
    const currentPhase = failure ? 'error' : phase;
    return {
      available: true,
      phase: currentPhase,
      configured: !!settings,
      config: settings ? {
        publicHost: settings.publicHost,
        username: settings.username,
        ngrokPath: settings.ngrokPath,
        proxyPort: settings.proxyPort,
        ngrokApiPort: settings.ngrokApiPort,
      } : {},
      hasPassword: !!settings?.password,
      hasAuthtoken: cachedHasAuthtoken,
      canDisable: !!proxy || !!tunnel || !!releaseLock,
      ...(currentCode ? { code: currentCode } : {}),
      ...(currentPhase === 'enabled' && url ? { url } : {}),
    };
  };

  const settingsForSave = async (input: RemoteSettingsInput): Promise<{ settings: StoredSettings; tokenConfig?: string; previousToken?: string }> => {
    await loadCache();
    const previous = cachedSettings;
    const password = typeof input.password === 'string' && input.password.length ? input.password : previous?.password;
    if (!password) return throwCode('remote_configuration_invalid');
    const value = validateStored({
      format: 1,
      publicHost: input.publicHost,
      username: input.username,
      password,
      ngrokPath: typeof input.ngrokPath === 'string' && input.ngrokPath.trim() ? input.ngrokPath.trim() : previous?.ngrokPath ?? 'ngrok',
      proxyPort: input.proxyPort ?? previous?.proxyPort ?? 57094,
      ngrokApiPort: input.ngrokApiPort ?? previous?.ngrokApiPort ?? 4040,
    });
    let tokenConfig: string | undefined;
    if (typeof input.authtoken === 'string' && input.authtoken.length) {
      try { tokenConfig = buildNgrokAuthtokenConfig(input.authtoken); }
      catch (error) { throw new Error('remote_configuration_invalid', { cause: error }); }
    }
    const previousToken = await readPrivateText(authtokenPath);
    return { settings: value, ...(tokenConfig ? { tokenConfig } : {}), ...(previousToken !== undefined ? { previousToken } : {}) };
  };

  const save = async (value?: unknown): Promise<PublicRemoteSettings> => {
    if (transition || phase === 'enabled' || phase === 'starting' || phase === 'stopping') return throwCode('remote_busy');
    transition = true;
    let release: (() => Promise<void>) | undefined;
    try {
      const input = parseInput(value);
      const prepared = await settingsForSave(input);
      release = await acquireRemoteAccessLock(runtimeRoot);
      try {
        if (prepared.tokenConfig) await writePrivateFile(authtokenPath, prepared.tokenConfig);
        await writePrivateFile(settingsPath, `${JSON.stringify(prepared.settings, null, 2)}\n`);
      } catch (error) {
        if (prepared.tokenConfig) {
          if (prepared.previousToken !== undefined) await writePrivateFile(authtokenPath, prepared.previousToken).catch(() => undefined);
          else await rm(authtokenPath, { force: true }).catch(() => undefined);
        }
        throw error;
      }
      cachedSettings = prepared.settings;
      cachedHasAuthtoken = prepared.tokenConfig ? true : prepared.previousToken !== undefined ? validAuthtokenConfig(prepared.previousToken) : false;
      cachedFailure = undefined;
      cacheLoaded = true;
      code = undefined;
      phase = 'disabled';
      return await status();
    } catch (error) {
      const mapped = errorCode(error);
      if (mapped === 'remote_busy' || mapped === 'remote_input_invalid') throw error;
      if (mapped === 'remote_configuration_invalid') throw new Error(mapped, { cause: error });
      throw new Error('remote_save_failed', { cause: error });
    } finally { await release?.(); transition = false; }
  };

  const enable = async (value?: unknown): Promise<PublicRemoteSettings> => {
    parseInput(value);
    if (phase === 'enabled' && proxy && tunnel) return status();
    if (transition || phase === 'starting' || phase === 'stopping') return throwCode('remote_busy');
    transition = true;
    phase = 'starting';
    code = undefined;
    try {
      // A previous failed start may still own a resource or its lock because
      // cleanup was transiently denied. Retry that owned cleanup before
      // acquiring the same lock again, instead of making the next click fail
      // with remote_busy and requiring a third attempt.
      if (releaseLock || proxy || tunnel) await stopOwnedResources();
      const settings = await readSettings();
      if (!settings) return throwCode('remote_configuration_required');
      const localUrl = await getLoginUrl();
      const localPort = localPortFromUrl(localUrl);
      if (!localPort) return throwCode('remote_configuration_required');
      let config: RemoteAccessConfig;
      try { config = validateRemoteConfig({ ...settings, format: 1, localPort }); }
      catch (error) { throw new Error('remote_configuration_invalid', { cause: error }); }
      releaseLock = await acquireRemoteAccessLock(runtimeRoot);
      const privateToken = await readPrivateText(authtokenPath);
      let baseConfigPath: string;
      if (privateToken !== undefined) {
        let parsed: unknown;
        try { parsed = parse(privateToken); } catch (error) { throw new Error('remote_configuration_invalid', { cause: error }); }
        const token = (parsed as { version?: unknown; agent?: { authtoken?: unknown } })?.agent?.authtoken;
        if ((parsed as { version?: unknown })?.version !== 3 || typeof token !== 'string' || !token) throw new Error('remote_configuration_invalid');
        baseConfigPath = authtokenPath;
      } else {
        baseConfigPath = await checkNgrok(config.ngrokPath);
      }
      await writePrivateFile(policyPath, buildNgrokPolicy(config));
      proxy = await launchProxy({
        localPort: config.localPort,
        proxyPort: config.proxyPort,
        publicHost: config.publicHost,
        username: config.username,
        password: config.password,
        getLoginUrl: async () => await getLoginUrl(),
      });
      try { tunnel = await launchTunnel(config, policyPath, baseConfigPath, overlayPath, controllerLogPath); }
      catch (error) { await proxy.close(); proxy = undefined; throw error; }
      let endpoint: URL;
      try { endpoint = new URL(tunnel.publicUrl); }
      catch (error) { throw new Error('remote_start_failed', { cause: error }); }
      if (endpoint.origin !== `https://${settings.publicHost}` || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash)
        throw new Error('remote_start_failed');
      url = new URL('/login', endpoint.origin).href;
      phase = 'enabled';
      code = undefined;
      const runningTunnel = tunnel;
      void runningTunnel.exited.catch(() => {
        if (tunnel !== runningTunnel || phase !== 'enabled') return;
        void (async () => {
          while (transition && tunnel === runningTunnel) await new Promise(resolveWait => setTimeout(resolveWait, 10));
          if (tunnel !== runningTunnel || phase !== 'enabled') return;
          transition = true;
          phase = 'stopping';
          try { await stopOwnedResources(); }
          catch { /* The disabled tunnel handle remains available for an explicit retry. */ }
          phase = 'error';
          code = 'remote_start_failed';
          url = undefined;
          transition = false;
        })();
      });
      return await status();
    } catch (error) {
      await stopOwnedResources().catch(() => undefined);
      phase = 'error';
      code = errorCode(error);
      throw new Error(code, { cause: error });
    } finally { transition = false; }
  };

  const stopOwnedResources = async (): Promise<void> => {
    const currentTunnel = tunnel;
    const currentProxy = proxy;
    let failed = false;
    try { await currentTunnel?.stop(); tunnel = undefined; } catch { failed = true; }
    try { await currentProxy?.close(); proxy = undefined; } catch { failed = true; }
    if (!tunnel && !proxy) await Promise.all([
      rm(policyPath, { force: true }).catch(() => undefined),
      rm(overlayPath, { force: true }).catch(() => undefined),
    ]);
    if (releaseLock && !failed) {
      const release = releaseLock;
      try { await release(); releaseLock = undefined; }
      catch { failed = true; }
    }
    if (failed) throw new Error('remote_stop_failed');
  };

  const disable = async (value?: unknown): Promise<PublicRemoteSettings> => {
    parseInput(value);
    if (transition || phase === 'starting' || phase === 'stopping') return throwCode('remote_busy');
    if (phase === 'disabled' && !proxy && !tunnel) return status();
    transition = true;
    phase = 'stopping';
    try {
      await stopOwnedResources();
      phase = 'disabled';
      code = undefined;
      url = undefined;
      return await status();
    } catch (error) {
      phase = 'error';
      code = 'remote_stop_failed';
      throw new Error('remote_stop_failed', { cause: error });
    } finally { transition = false; }
  };

  const close = async (): Promise<void> => {
    if (transition) {
      const deadline = Date.now() + 60_000;
      while (transition && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 20));
    }
    if (transition) throw new Error('remote_stop_failed');
    await disable({});
  };

  return { status, save, enable, disable, close };
}

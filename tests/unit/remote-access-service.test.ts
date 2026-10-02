import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { expect, test } from 'vitest';
import { createRemoteAccessService, type RemoteAccessDependencies } from '../../scripts/remote-access-service.ts';
import type { RemoteProxy } from '../../scripts/remote-access-proxy.ts';
import type { NgrokTunnel } from '../../scripts/remote-ngrok.ts';

const loginUrl = 'http://127.0.0.1:57321/?token=synthetic-login-token';
const defaults = {
  publicHost: 'notara-synthetic.example.invalid',
  username: 'synthetic-user',
  password: 'synthetic-remote-password-42',
  proxyPort: 57322,
  ngrokApiPort: 57323,
  ngrokPath: 'fixture-ngrok',
};

test('remote Settings save privately, stay optional, and serialize save/enable/disable with retryable shutdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-remote-settings-service-'));
  let proxyStartEntered!: () => void;
  const proxyStartGate = new Promise<void>(resolve => { proxyStartEntered = resolve; });
  let releaseProxyStart!: () => void;
  const proxyStart = new Promise<void>(resolve => { releaseProxyStart = resolve; });
  let stopAttempts = 0;
  let proxyClosed = 0;
  let tunnelStarted = 0;
  let observedConfig: { localPort: number; baseConfigPath: string; password: string } | undefined;
  const dependencies: RemoteAccessDependencies = {
    assertNgrokReady: async () => { throw new Error('Private Authtoken config should be used.'); },
    startProxy: async options => {
      proxyStartEntered();
      await proxyStart;
      return { port: options.proxyPort, close: async () => { proxyClosed++; } } satisfies RemoteProxy;
    },
    startTunnel: async (config, _policyPath, baseConfigPath) => {
      tunnelStarted++;
      observedConfig = { localPort: config.localPort, baseConfigPath, password: config.password };
      const exited = new Promise<never>(() => {});
      void exited.catch(() => undefined);
      return {
        publicUrl: `https://${config.publicHost}`,
        exited,
        async stop() { stopAttempts++; if (stopAttempts === 1) throw new Error('fixture stop failure'); },
      } satisfies NgrokTunnel;
    },
  };
  const service = createRemoteAccessService(root, () => loginUrl, dependencies);
  try {
    const initial = await service.status({});
    expect(initial).toMatchObject({ available: true, phase: 'disabled', configured: false, canDisable: false });
    expect(tunnelStarted).toBe(0);

    const saved = await service.save({ ...defaults, authtoken: 'synthetic-ngrok-token' });
    expect(saved).toMatchObject({ phase: 'disabled', configured: true, hasPassword: true, hasAuthtoken: true, canDisable: false,
      config: { publicHost: defaults.publicHost, username: defaults.username, proxyPort: defaults.proxyPort, ngrokApiPort: defaults.ngrokApiPort } });
    for (const secret of [defaults.password, 'synthetic-ngrok-token']) expect(JSON.stringify(saved)).not.toContain(secret);
    expect(tunnelStarted).toBe(0);
    const stored = JSON.parse(await readFile(join(root, '.notara', 'remote-access', 'settings.json'), 'utf8')) as Record<string, unknown>;
    expect(stored.password).toBe(defaults.password);
    expect(stored).not.toHaveProperty('authtoken');
    const ngrok = parse(await readFile(join(root, '.notara', 'remote-access', 'ngrok.yml'), 'utf8')) as { agent: { authtoken: string } };
    expect(ngrok.agent.authtoken).toBe('synthetic-ngrok-token');

    const enabling = service.enable({});
    await proxyStartGate;
    await expect(service.save({ ...defaults, password: '' })).rejects.toThrow('remote_busy');
    await expect(service.disable({})).rejects.toThrow('remote_busy');
    releaseProxyStart();
    const enabled = await enabling;
    expect(enabled).toMatchObject({ phase: 'enabled', canDisable: true, url: `https://${defaults.publicHost}/login` });
    expect(observedConfig).toMatchObject({ localPort: 57321, password: defaults.password });
    expect(observedConfig?.baseConfigPath).toBe(join(root, '.notara', 'remote-access', 'ngrok.yml'));

    await expect(service.disable({})).rejects.toThrow('remote_stop_failed');
    expect(await service.status({})).toMatchObject({ phase: 'error', canDisable: true, code: 'remote_stop_failed' });
    expect(proxyClosed).toBe(1);
    const stopped = await service.disable({});
    expect(stopped).toMatchObject({ phase: 'disabled', canDisable: false, configured: true });
    expect(stopAttempts).toBe(2);
  } finally {
    await service.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test('remote remains disabled by default and rejects expression-like ngrok credentials without writing settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-remote-settings-off-'));
  let proxyStarts = 0;
  const service = createRemoteAccessService(root, () => loginUrl, {
    startProxy: async options => { proxyStarts++; return { port: options.proxyPort, close: async () => undefined }; },
    startTunnel: async config => {
      const exited = new Promise<never>(() => {});
      return { publicUrl: `https://${config.publicHost}`, exited, stop: async () => undefined };
    },
  });
  try {
    await expect(service.enable({})).rejects.toThrow('remote_configuration_required');
    await expect(service.save({ ...defaults, authtoken: '${env.SECRET}' })).rejects.toThrow('remote_configuration_invalid');
    expect(await service.status({})).toMatchObject({ phase: 'error', configured: false, canDisable: false });
    expect(proxyStarts).toBe(0);
  } finally {
    await service.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test('startup failures and abrupt tunnel exits clean resources and release the per-runtime lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-remote-exit-'));
  let starts = 0, proxyCloses = 0, tunnelStops = 0;
  const exitRejectors: Array<(reason: Error) => void> = [];
  const dependencies: RemoteAccessDependencies = {
    assertNgrokReady: async () => join(root, 'fixture-global-ngrok.yml'),
    startProxy: async options => ({ port: options.proxyPort, close: async () => { proxyCloses++; } }),
    startTunnel: async config => {
      starts++;
      if (starts === 1) throw new Error('synthetic tunnel startup failure');
      const exited = new Promise<never>((_resolve, reject) => { exitRejectors.push(reject); });
      void exited.catch(() => undefined);
      return { publicUrl: `https://${config.publicHost}`, exited, async stop() { tunnelStops++; } };
    },
  };
  const first = createRemoteAccessService(root, () => loginUrl, dependencies);
  const second = createRemoteAccessService(root, () => loginUrl, dependencies);
  const eventually = async (service: ReturnType<typeof createRemoteAccessService>, predicate: (value: Awaited<ReturnType<typeof service.status>>) => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await service.status({});
      if (predicate(value)) return value;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Remote service state did not settle.');
  };
  try {
    await first.save(defaults);
    await expect(first.enable({})).rejects.toThrow('remote_start_failed');
    expect(await first.status({})).toMatchObject({ phase: 'error', canDisable: false, code: 'remote_start_failed' });
    expect(proxyCloses).toBe(1);
    await expect(readFile(join(root, '.notara', 'remote-access', 'policy.yml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await first.enable({});
    expect(starts).toBe(2);
    await expect(second.enable({})).rejects.toThrow('remote_busy');
    expect(await second.status({})).toMatchObject({ phase: 'error', canDisable: false, code: 'remote_busy' });

    exitRejectors[0]!(new Error('synthetic ngrok exit'));
    expect(await eventually(first, value => value.phase === 'error' && !value.canDisable)).toMatchObject({ code: 'remote_start_failed' });
    expect(tunnelStops).toBe(1);
    await expect(second.enable({})).resolves.toMatchObject({ phase: 'enabled', canDisable: true });
    expect(starts).toBe(3);
    await second.disable({});
    expect(tunnelStops).toBe(2);
  } finally {
    await Promise.all([first.close().catch(() => undefined), second.close().catch(() => undefined)]);
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

import { expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
import { startVaultPersistent, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

const { parseGoCatalog } = await import(new URL('../../scripts/opencode-go-catalog.mjs', import.meta.url).href) as {
  parseGoCatalog(listing: unknown, metadata: unknown): unknown;
};

test('a fresh native Host registers a newly discovered mixed Go route from its own persisted catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-native-go-catalog-'));
  let runtime: VaultRuntime | undefined;
  let client: Awaited<ReturnType<typeof connectVault>> | undefined;
  try {
    runtime = await startVaultPersistent(root, { port: 0, testModel: true });
    client = await connectVault(runtime);
    const initialDirectory = client.value(await client.rpc<{ provider: string; settingsNs: string }[]>('llm/listConfigurableProviders', {}));
    const settingsNs = initialDirectory.find(entry => entry.provider === 'opencode-go')!.settingsNs;
    expect(settingsNs).not.toBe('');
    await client.close(); client = undefined;
    await runtime.stop(); runtime = undefined;
    const ids = ['deepseek-v4.1-flash', 'gpt-6-luna', 'minimax-m3'];
    const models = Object.fromEntries(ids.map((id, index) => [id, {
      id, name: id, limit: { context: 262144, output: 32768 }, modalities: { input: ['text'] },
      ...(index === 0 ? {} : { provider: { npm: index === 1 ? '@ai-sdk/openai' : '@ai-sdk/anthropic' } }),
    }]));
    const snapshot = parseGoCatalog({ data: ids.map(id => ({ id })) }, { 'opencode-go': {
      api: 'https://opencode.ai/zen/go/v1', npm: '@ai-sdk/openai-compatible', models,
    } });
    const catalogDir = join(root, 'home/.notara/model-catalog');
    await mkdir(catalogDir, { recursive: true });
    await writeFile(join(catalogDir, 'opencode-go.json'), JSON.stringify(snapshot));
    const patchPath = join(root, 'home/profiles/web/cordis.patch.yml');
    const patch = parse(await readFile(patchPath, 'utf8')) as unknown[];
    patch.push({ id: settingsNs, config: { providers: { 'opencode-go': {
      displayName: 'Cached Go fixture', apiKeyEnv: 'ISOLATED_SYNTHETIC_GO_KEY', models: ids.map(id => ({ id })),
    } } } });
    await writeFile(patchPath, JSON.stringify(patch));
    runtime = await startVaultPersistent(root);
    client = await connectVault(runtime);
    const providers = client.value(await client.rpc<{ id: string }[]>('llm/listProviders', {}));
    expect(providers.some(provider => provider.id === 'opencode-go')).toBe(true);
    const directory = client.value(await client.rpc<{ provider: string; displayName: string; declared?: boolean; error?: string }[]>('llm/listConfigurableProviders', {}));
    // `declared` means a custom provider; built-in Go remains false even when configured.
    expect(directory.find(entry => entry.provider === 'opencode-go')).toMatchObject({ displayName: 'Cached Go fixture', declared: false });
    expect(directory.find(entry => entry.provider === 'opencode-go')!.error).toBeUndefined();
    expect(await readFile(join(catalogDir, 'opencode-go.json'), 'utf8')).toBe(JSON.stringify(snapshot));
    // The synthetic teacher stays on its own route; no Go model request is made.
  } finally {
    await client?.close();
    await runtime?.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 120000);

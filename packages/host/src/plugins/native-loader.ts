import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/cordis-plugin-loader';
import type {} from '@deepseek-ai/dsh-client-modules';
import { loadProfileDirectory } from '@deepseek-ai/dsh-app-boot';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PluginVersion } from '@studyforge/contracts/plugins';
import { dshAnchor, inside, pluginRoot } from './package-source.ts';

/** Only the top Loader is mutated: its write() is a no-op. Never edit the boot Include. */
export interface NativeMount { dispose(): Promise<void>; ready(): boolean }
export async function loadNative(host: Context, version: PluginVersion): Promise<NativeMount> {
  if (!version.native) return { dispose: async () => {}, ready: () => true };
  const profileDir = inside(join(pluginRoot(host.studyforgeAccess.root), version.snapshot), version.profilePath);
  const profile = loadProfileDirectory('dsh', profileDir, dshAnchor, { userLayer: false });
  const path = join(profileDir, 'notara-runtime.json');
  await writeFile(path, '[]', { mode: 0o600 });
  const before = new Set(host.clientModules?.graph().entries.map(entry => entry.id) ?? []);
  const id = await host.loader.create({ name: '@deepseek-ai/cordis-plugin-include', config: { path, patches: profile.layers.flatMap(layer => layer.patches), enableLogs: false } });
  try {
    const entry = host.loader.resolve(id);
    // Waiting for the whole Loader during Host startup would wait on ourselves.
    await entry.fiber?.await();
    const children = [...(entry.subtree?.entries() ?? [])];
    // Cordis 4.0.2 exports FiberState as an ambient const enum (ACTIVE = 2).
    for (const child of children) { await child.fiber?.await(); if (!child.disabled && child.fiber?.state !== 2) throw new Error('plugin_native_not_ready'); }
    if (entry.fiber?.state !== 2) throw new Error('plugin_native_not_ready');
    if (host.clientModules?.graph().entries.some(row => !before.has(row.id))) throw new Error('plugin_native_client_unsupported');
    return { dispose: async () => { await host.loader.remove(id); }, ready: () => !entry.disabled && entry.fiber?.state === 2 && [...(entry.subtree?.entries() ?? [])].every(child => child.disabled || child.fiber?.state === 2) };
  } catch (error) { await host.loader.remove(id); throw error; }
}

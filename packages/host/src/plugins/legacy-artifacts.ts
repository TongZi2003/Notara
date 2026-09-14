import type { Context } from '@deepseek-ai/cordis';
import { randomUUID } from 'node:crypto';
import { PluginManifestSchema, type PluginView } from '@studyforge/contracts/plugins';
import { creationPlugin } from '../creation/package-publication.ts';

/** Existing fixed artifact snapshots remain readable; only their active registration is retired. */
export function legacyPlugins(host: Context): PluginView[] {
  const manager = host.studyforgePluginsManager;
  return host.studyforgeInstalledArtifacts.list(manager.context()).filter(row => !row.data.removed && !creationPlugin(host, row.data.projectRef)).flatMap(row => {
    const current = row.data.versions.find(version => version.digest === row.data.activeDigest)!;
    if (current.manifest.kind === 'markdown') return [];
    const source = current.manifest;
    const contribution = { id: 'main', title: source.title, description: source.description, entry: source.entry, ...(source.kind === 'subject' ? { subjects: source.subjects } : {}) };
    const manifest = PluginManifestSchema.parse({ name: '@notara/creation-' + row.data.projectRef.slice(9), version: '0.0.' + row.version, notara: { apiVersion: 1, title: source.title, description: source.description,
      [source.kind === 'subject' ? 'subjects' : source.kind === 'teaching' ? 'teaching' : 'skills']: [contribution] } });
    return [{ ref: 'legacy:' + row.data.projectRef.slice(9), revision: row.version, name: manifest.name, title: source.title, description: source.description,
      version: manifest.version, digest: current.digest, enabled: row.data.enabled, native: false, state: row.data.enabled ? 'enabled' as const : 'installed' as const, manifest, creationRef: row.data.projectRef }];
  });
}
export async function changeLegacyPlugin(host: Context, input: { ref: string; expectedVersion: number }, enabled: boolean, remove = false): Promise<PluginView> {
  const item = legacyPlugins(host).find(row => row.ref === input.ref); if (!item) throw new Error('plugin_not_installed');
  const record = await host.studyforgeInstalledArtifacts.update({ ...host.studyforgePluginsManager.context(), operationId: randomUUID(), expectedVersion: input.expectedVersion }, 'artifact:' + input.ref.slice(7),
    { enabled, removed: remove }, previous => ({ ...previous, enabled, removed: remove }));
  host.studyforgePluginsManager.changed(); return { ...item, revision: record.version, enabled, state: enabled ? 'enabled' : 'installed' };
}

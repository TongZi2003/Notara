import type { Context } from '@deepseek-ai/cordis';
import type { ArtifactView, ArtifactInstallation, ArtifactManifest } from '@studyforge/contracts/creation';
import { artifactEntry } from '@studyforge/contracts/creation';
import { mkdir, writeFile } from 'node:fs/promises';
import { rejected } from '../tools/learning-context.ts';
import { join } from 'node:path';
import type { PluginVersion } from '@studyforge/contracts/plugins';

export function creationPlugin(host: Context, ref: string) {
  return host.studyforgePluginsManager.records.list(host.studyforgePluginsManager.context()).find(row => row.data.versions.some(version => version.creation?.ref === ref));
}
export function creationInstallation(host: Context, ref: string): ArtifactInstallation | undefined {
  const row = creationPlugin(host, ref); if (!row?.data.installed) return undefined;
  const version = row.data.versions.find(item => item.digest === row.data.activeDigest)!;
  return { revision: row.version, enabled: host.studyforgePluginsManager.list().find(item => item.ref === row.ref)?.state === 'enabled', digest: version.creation!.digest, title: version.manifest.notara.title, kind: version.creation!.kind };
}
export function creationManifest(version: PluginVersion): ArtifactManifest {
  const kind = version.creation!.kind, manifest = version.manifest.notara;
  return { title: manifest.title, description: manifest.description, kind, subjects: manifest.subjects.flatMap(item => item.subjects), entry: artifactEntry(kind) };
}
export async function publishCreationPackage(host: Context, view: ArtifactView, expectedVersion: number): Promise<ArtifactInstallation> {
  const manifest = view.manifest!;
  if (manifest.kind === 'markdown') throw rejected('这份作品是Markdown不是插件包，不能作为插件安装');
  const current = creationPlugin(host, view.ref), manager = host.studyforgePluginsManager;
  const known = current?.data.versions.find(item => item.creation?.digest === view.digest);
  if (current?.data.installed && current.data.activeDigest === known?.digest && current.data.enabled) return creationInstallation(host, view.ref)!;
  const legacy = host.studyforgeInstalledArtifacts.list(manager.context()).find(row => row.data.projectRef === view.ref);
  if ((current?.data.installed ? current.version : legacy && !legacy.data.removed ? legacy.version : 0) !== expectedVersion) throw rejected('插件安装状态在你读取后已变化，重新读取后再提交');
  const source = join(host.studyforgeAccess.root, '.studyforge', 'creator-plugins', view.ref.slice(9), view.digest);
  await mkdir(source, { recursive: true, mode: 0o700 });
  const entry = { id: 'main', title: manifest.title, description: manifest.description, entry: manifest.entry };
  const capabilities = { apiVersion: 1, title: manifest.title, description: manifest.description,
    [manifest.kind === 'classroom' ? 'worldbooks' : manifest.kind === 'html' ? 'workbenches' : manifest.kind === 'subject' ? 'subjects' : manifest.kind === 'teaching' ? 'teaching' : 'skills']:
      [{ ...entry, ...(manifest.kind === 'html' ? { permissions: [] } : manifest.kind === 'subject' ? { subjects: manifest.subjects } : {}) }] };
  const version = known?.manifest.version ?? '1.0.' + (current?.data.versions.length ?? 0);
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@notara/creation-' + view.ref.slice(9), version, notara: capabilities }));
  await writeFile(join(source, manifest.entry), view.files.find(file => file.path === manifest.entry)!.body);
  const candidate = await manager.prepare({ kind: 'directory', path: source });
  await manager.tagCreation(candidate.candidateId, { ref: view.ref, digest: view.digest, kind: manifest.kind });
  await manager.install({ candidateId: candidate.candidateId, expectedVersion: current?.data.installed ? current.version : 0, trustNative: false });
  return creationInstallation(host, view.ref)!;
}

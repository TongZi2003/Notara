import { mkdirSync, existsSync, readFileSync, writeFileSync, realpathSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { HostContext } from '@studyforge/contracts';
import type { InstalledArtifactSchema, ArtifactInstallation, ArtifactCheck, ArtifactView, ArtifactManifest } from '@studyforge/contracts/creation';
import type { RecordStore, PreparedRecordChange } from '@studyforge/domain/storage';
import { z } from 'zod';
import { canonicalPath } from '@studyforge/domain/access';
import { readProject, fileDigest, projectRoot } from './project-store.ts';
import { creationPlugin, creationInstallation, creationManifest, publishCreationPackage } from './package-publication.ts';
import { pluginSkillId } from '../plugins/plugin-manager.ts';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeInstalledArtifacts: RecordStore<typeof InstalledArtifactSchema>; } }

const workspaceContext = (host: Context): HostContext => ({ workspaceId: host.studyforgeAccess.workspaceId, actor: 'student', purpose: 'learning' });
const idOf = (ref: string): string => { if (!/^creation:[a-f0-9]{24}$/.test(ref)) throw new Error('artifact_target_invalid'); return ref.slice('creation:'.length); };
export function installation(host: Context, ref: string): ArtifactInstallation | undefined {
  if (creationPlugin(host, ref)) return creationInstallation(host, ref);
  const row = host.studyforgeInstalledArtifacts.list(workspaceContext(host)).find(row => row.data.projectRef === ref);
  if (!row || row.data.removed) return undefined;
  const version = row.data.versions.find(version => version.digest === row.data.activeDigest)!;
  return { revision: row.version, enabled: row.data.enabled, digest: version.digest, title: version.manifest.title, kind: version.manifest.kind,
    ...(version.publication ? { publication: version.publication } : {}) };
}
function snapshotRoot(host: Context, projectRef: string, digest: string): string {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('artifact_digest_invalid');
  const path = join(host.studyforgeAccess.root, '.studyforge', 'artifacts', idOf(projectRef), digest);
  if (canonicalPath(path, host.studyforgeAccess.root) !== path) throw new Error('artifact_path_invalid');
  return path;
}
export function artifactCheck(host: Context, ref: string): ArtifactCheck {
  const context = workspaceContext(host), view = readProject(host, host.studyforgeCreationRecords.read(context, ref));
  const issues: string[] = [];
  const project = host.studyforgeCreationRecords.read(context, ref);
  if (readdirSync(projectRoot(host, project.data.name)).some(path => !['manifest.json', 'content.md', 'index.html'].includes(path))) issues.push('请把依赖合并进正文，作品只支持自包含文件。');
  if (!view.manifest) issues.push('作品设置尚未完整。');
  else {
    const body = view.files.find(file => file.path === view.manifest!.entry)?.body;
    if (!body?.trim()) issues.push('请补上作品正文。');
    if (view.manifest.kind === 'subject' && !view.manifest.subjects.length) issues.push('请填写这份教法适用的科目。');
    if (view.manifest.kind === 'html' && !/<(?:html|body|main|div|section|canvas|svg)\b/i.test(body ?? '')) issues.push('请提供完整的 HTML 演示内容。');
  }
  const current = installation(host, ref);
  return { digest: view.digest, issues, ...(current ? { installation: current } : {}) };
}
export async function installArtifact(host: Context, input: { ref: string; digest: string; operationId: string; expectedVersion: number }): Promise<ArtifactInstallation> {
  z.object({ ref: z.string().regex(/^creation:[a-f0-9]{24}$/), digest: z.string().regex(/^[a-f0-9]{64}$/), operationId: z.string().min(1), expectedVersion: z.number().int().nonnegative() }).strict().parse(input);
  const context = workspaceContext(host), project = host.studyforgeCreationRecords.read(context, input.ref), view = readProject(host, project), check = artifactCheck(host, input.ref);
  if (view.digest !== input.digest) throw new Error('artifact_snapshot_changed');
  if (check.issues.length || !view.manifest) throw new Error('artifact_not_ready');
  if (view.manifest.kind !== 'markdown' && !project.data.target) return publishCreationPackage(host, view, input.expectedVersion);
  const current = host.studyforgeInstalledArtifacts.list(context).find(row => row.data.projectRef === input.ref);
  const known = current?.data.versions.find(version => version.digest === input.digest);
  if (current?.data.enabled && !current.data.removed && current.data.activeDigest === input.digest) return installation(host, input.ref)!;
  if ((current?.data.removed ? 0 : current?.version ?? 0) !== input.expectedVersion) throw new Error('version_conflict');
  const path = snapshotRoot(host, input.ref, input.digest); mkdirSync(path, { recursive: true, mode: 0o700 });
  for (const file of view.files) {
    const absolute = join(path, file.path);
    if (existsSync(absolute)) { if (realpathSync(absolute) !== absolute || fileDigest(readFileSync(absolute)) !== file.digest) throw new Error('artifact_snapshot_corrupt'); }
    else writeFileSync(absolute, file.body, { flag: 'wx', mode: 0o600 });
  }
  let publication = known?.publication;
  let savedRevision = 0;
  const publish = async (material?: PreparedRecordChange): Promise<void> => {
    const version = known ?? { digest: input.digest, manifest: view.manifest!, files: view.files.map(file => ({ path: file.path, digest: file.digest })), installedAt: new Date().toISOString(), ...(publication ? { publication } : {}) };
    const record = { projectRef: input.ref, activeDigest: input.digest, enabled: true, removed: false, versions: [version] };
    const mutation = { ...context, operationId: input.operationId + ':artifact:' + (current?.version ?? 0), expectedVersion: current?.version ?? 0 };
    const change = !current
      ? host.studyforgeInstalledArtifacts.prepareCreate(mutation, idOf(input.ref), record)
      : host.studyforgeInstalledArtifacts.prepareUpdate(mutation, 'artifact:' + idOf(input.ref), { digest: input.digest }, previous => ({ ...previous, activeDigest: input.digest, enabled: true, removed: false,
        versions: previous.versions.some(item => item.digest === input.digest) ? previous.versions : [...previous.versions, version] }));
    await host.studyforgeRecords.atomic(material ? [material, change] : [change]); savedRevision = change.result.version;
  };
  const previousPublication = current?.data.versions.find(version => version.digest === current.data.activeDigest)?.publication;
  if (!publication && (project.data.target || view.manifest.kind === 'markdown')) {
    const source = view.files.find(file => file.path === view.manifest!.entry)!;
    const target = previousPublication ?? project.data.target;
    if (target) {
      const original = await host.studyforgeMaterialService.get(context, target.ref.slice('material:'.length));
      const saved = await host.studyforgeMaterialService.createVersion({ ...context, operationId: input.operationId + ':material', expectedVersion: 'revision' in target ? target.revision : target.version },
        { materialId: original.materialId, title: view.manifest.title, fileName: original.fileName, mediaType: original.mediaType, bytes: Buffer.from(source.body) }, async (change, saved) => {
          publication = { ref: 'material:' + saved.materialId, revision: saved.revision }; await publish(change);
        });
      publication = { ref: 'material:' + saved.materialId, revision: saved.revision };
    } else {
      const saved = await host.studyforgeMaterialService.import({ ...context, operationId: input.operationId + ':material' },
        { title: view.manifest.title, fileName: view.manifest.title.replace(/[\\/]/g, '-') + '.md', mediaType: 'text/markdown', bytes: Buffer.from(source.body) }, async (change, saved) => {
          publication = { ref: 'material:' + saved.materialId, revision: saved.revision }; await publish(change);
        });
      publication = { ref: 'material:' + saved.materialId, revision: saved.revision };
    }
  }
  if (!savedRevision) await publish();
  host.studyforgePluginsManager.changed();
  return { revision: savedRevision, enabled: true, digest: input.digest, title: view.manifest.title, kind: view.manifest.kind, ...(publication ? { publication } : {}) };
}

export function artifactSkillName(projectRef: string, digest: string): string {
  if (projectRef.startsWith('plugin:')) { const [ref, id] = projectRef.split('#'); return pluginSkillId(ref!, digest, id!); }
  return 'studyforge-user-' + idOf(projectRef) + '-' + digest.slice(0, 16);
}
export function activeArtifacts(host: Context): { ref: string; digest: string; manifest: ArtifactManifest; installedAt: string }[] {
  const bundled = host.studyforgePluginsManager.active().flatMap(({ ref, version }) => {
    if (version.creation) return [{ ref: version.creation.ref, digest: version.creation.digest, manifest: creationManifest(version), installedAt: version.installedAt }];
    const entries = [ ...version.manifest.notara.skills.map(item => ({ ...item, kind: 'skill' as const, subjects: [] as string[] })),
      ...version.manifest.notara.teaching.map(item => ({ ...item, kind: 'teaching' as const, subjects: [] as string[] })),
      ...version.manifest.notara.subjects.map(item => ({ ...item, kind: 'subject' as const })) ];
    return entries.map(item => ({ ref: ref + '#' + item.id, digest: version.digest, manifest: { title: item.title, description: item.description, kind: item.kind, subjects: item.subjects, entry: 'content.md' as const }, installedAt: version.installedAt }));
  });
  return [...bundled, ...host.studyforgeInstalledArtifacts.list(workspaceContext(host)).filter(row => row.data.enabled && !creationPlugin(host, row.data.projectRef)).flatMap(row => {
    const active = row.data.versions.find(version => version.digest === row.data.activeDigest);
    return active ? [{ ref: row.data.projectRef, digest: active.digest, manifest: active.manifest, installedAt: active.installedAt }] : [];
  })];
}
export function installedBody(host: Context, ref: string, digest: string): { manifest: ArtifactManifest; body: string } {
  if (ref.startsWith('plugin:')) {
    const [pluginRef, id] = ref.split('#'), version = host.studyforgePluginsManager.get(pluginRef!, digest);
    const options = version.manifest.notara;
    const item = options.skills.find(item => item.id === id) ?? options.teaching.find(item => item.id === id) ?? options.subjects.find(item => item.id === id);
    if (!item) throw new Error('plugin_contribution_missing');
    const kind = options.skills.includes(item) ? 'skill' : options.teaching.includes(item) ? 'teaching' : 'subject';
    return { manifest: { kind, title: item.title, description: item.description, subjects: 'subjects' in item ? item.subjects as string[] : [], entry: 'content.md' }, body: host.studyforgePluginsManager.body(pluginRef!, digest, item.entry) };
  }
  const packaged = creationPlugin(host, ref);
  if (packaged) {
    const version = packaged.data.versions.find(item => item.creation?.digest === digest);
    if (version) { const manifest = creationManifest(version); return { manifest, body: host.studyforgePluginsManager.body(packaged.ref, version.digest, manifest.entry) }; }
  }
  const row = host.studyforgeInstalledArtifacts.read(workspaceContext(host), 'artifact:' + idOf(ref));
  const version = row.data.versions.find(item => item.digest === digest);
  if (!version) throw new Error('artifact_version_missing');
  const path = snapshotRoot(host, ref, digest), entry = version.files.find(file => file.path === version.manifest.entry);
  if (!entry) throw new Error('artifact_entry_missing');
  for (const item of version.files) {
    if (!['manifest.json', 'content.md', 'index.html'].includes(item.path)) throw new Error('artifact_snapshot_corrupt');
    const file = join(path, item.path);
    if (realpathSync(file) !== file || fileDigest(readFileSync(file)) !== item.digest) throw new Error('artifact_snapshot_corrupt');
  }
  const body = readFileSync(join(path, entry.path), 'utf8');
  return { manifest: version.manifest, body };
}

export async function setArtifactEnabled(host: Context, input: { ref: string; expectedVersion: number; operationId: string; enabled: boolean }): Promise<ArtifactInstallation> {
  const packaged = creationPlugin(host, input.ref);
  if (packaged) { await host.studyforgePluginsManager.setEnabled({ ref: packaged.ref, expectedVersion: input.expectedVersion, enabled: input.enabled }); return creationInstallation(host, input.ref)!; }
  await host.studyforgeInstalledArtifacts.update({ ...workspaceContext(host), expectedVersion: input.expectedVersion, operationId: input.operationId }, 'artifact:' + idOf(input.ref), { enabled: input.enabled }, previous => ({ ...previous, enabled: input.enabled }));
  host.studyforgePluginsManager.changed();
  return installation(host, input.ref)!;
}

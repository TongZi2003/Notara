import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, lstatSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { HostContext } from '@studyforge/contracts';
import { ArtifactManifestSchema, ClassroomDocumentSchema, type ArtifactView, type CreationRecord } from '@studyforge/contracts/creation';
import { canonicalPath, under } from '@studyforge/domain/access';
import type { Saved } from '@studyforge/domain/storage';

export const fileDigest = (body: string | Uint8Array): string => createHash('sha256').update(body).digest('hex');
export function projectRoot(host: Context, name: string): string {
  if (!/^work-[a-f0-9]{24}$/.test(name)) throw new Error('creation_target_invalid');
  const packs = join(host.studyforgeAccess.root, 'packs'), root = join(packs, name);
  if (!under(host.studyforgeAccess.root, canonicalPath(packs, host.studyforgeAccess.root)) || canonicalPath(root, host.studyforgeAccess.root) !== root) throw new Error('creation_path_invalid');
  return root;
}
export function initializeProject(host: Context, record: CreationRecord, content?: string): void {
  const root = projectRoot(host, record.name); mkdirSync(root, { recursive: true, mode: 0o700 });
  const manifest = join(root, 'manifest.json');
  if (!existsSync(manifest)) writeFileSync(manifest, JSON.stringify(record.initial, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const path = join(root, record.initial.entry);
  if (!existsSync(path)) writeFileSync(path, content ?? (record.initial.kind === 'classroom' ? JSON.stringify({ entries: [], classroom: { title: record.initial.title, roles: [], rules: [], carrySummary: false } }, null, 2) : record.initial.kind === 'html' ? '<!doctype html><html lang="zh"><meta charset="utf-8"><title>教学演示</title><body><main>从一个想演示的问题开始。</main></body></html>' : '# ' + record.initial.title + '\n\n'), { flag: 'wx', mode: 0o600 });
}
export function readProject(host: Context, record: Saved<CreationRecord>): ArtifactView {
  const root = projectRoot(host, record.data.name);
  const files = readdirSync(root).filter(path => ['manifest.json', 'content.md', 'index.html', 'worldbook.json'].includes(path)).map(path => {
    const absolute = join(root, path), stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute || stat.size > 1_000_000) throw new Error('creation_file_invalid');
    const body = readFileSync(absolute, 'utf8'); return { path, body, digest: fileDigest(body) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  let manifest: ArtifactView['manifest'] = null;
  try { const parsed = ArtifactManifestSchema.safeParse(JSON.parse(files.find(file => file.path === 'manifest.json')?.body ?? '')); if (parsed.success) manifest = parsed.data; } catch { /* A broken manifest remains editable. */ }
  return { ref: record.ref, sessionId: record.data.sessionId, revision: record.version, manifest, manifestError: manifest === null,
    files, digest: fileDigest(JSON.stringify(files.map(file => [file.path, file.digest]))), ...(record.data.target ? { target: record.data.target } : {}), ...(record.data.originSessionId ? { originSessionId: record.data.originSessionId } : {}) };
}
export function saveProjectFile(host: Context, context: HostContext, ref: string, path: string, expectedDigest: string, content: string): ArtifactView {
  const record = host.studyforgeCreationRecords.read(context, ref), root = projectRoot(host, record.data.name), file = join(root, path);
  if (!['manifest.json', 'content.md', 'index.html', 'worldbook.json'].includes(path) || canonicalPath(file, root) !== file) throw new Error('creation_file_invalid');
  if (path === 'worldbook.json') ClassroomDocumentSchema.parse(JSON.parse(content));
  // Synchronous comparison/publication has no JS yield between the final check
  // and rename. Native fs observes the same bytes and its stale guard sees edits.
  const before = existsSync(file) ? fileDigest(readFileSync(file)) : fileDigest('');
  if (before === fileDigest(content)) return readProject(host, record);
  if (before !== expectedDigest) throw new Error('creation_file_conflict');
  const temporary = join(root, '.' + path + '-' + crypto.randomUUID() + '.tmp');
  writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' }); renameSync(temporary, file);
  return readProject(host, record);
}

import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { HostContext } from '@studyforge/contracts';
import type { RecordStore, Saved } from '@studyforge/domain/storage';
import { PluginVersionSchema, type PluginRecordSchema, type PluginVersion, type PluginView, type PluginCandidate, type PluginSource, type WorkbenchChoice, type PluginPinSchema, type WorkbenchContent } from '@studyforge/contracts/plugins';
import { preparePackage, pluginRoot, readPluginText, snapshotFile } from './package-source.ts';
import { loadNative, type NativeMount } from './native-loader.ts';

type Row = Saved<import('@studyforge/contracts/plugins').PluginRecord>;
export const packageId = (name: string): string => createHash('sha256').update(name).digest('hex').slice(0, 24);
export const pluginSkillId = (ref: string, digest: string, id: string): string => `notara-${ref.slice(7)}-${digest.slice(0, 16)}-${id}`;
declare module '@deepseek-ai/cordis' { interface Context { studyforgePluginsManager: PluginManager } }

export class PluginManager {
  private tail = Promise.resolve();
  private loaded = new Map<string, NativeMount & { version: PluginVersion }>();
  private failures = new Map<string, string>();
  private listeners = new Set<() => void>();
  private closed = false;
  readonly host: Context;
  readonly records: RecordStore<typeof PluginRecordSchema>;
  readonly pins: RecordStore<typeof PluginPinSchema>;
  constructor(host: Context, records: RecordStore<typeof PluginRecordSchema>, pins: RecordStore<typeof PluginPinSchema>) { this.host = host; this.records = records; this.pins = pins; }
  context(): HostContext { return { workspaceId: this.host.studyforgeAccess.workspaceId, actor: 'student', purpose: 'learning' }; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  changed(): void { for (const listener of this.listeners) listener(); }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const task = this.tail.then(() => { if (this.closed) throw new Error('plugin_manager_closed'); return fn(); }); this.tail = task.then(() => {}, () => {}); return task; }
  private version(row: Row): PluginVersion { const version = row.data.versions.find(version => version.digest === row.data.activeDigest); if (!version) throw new Error('plugin_version_missing'); return version; }
  private view(row: Row): PluginView {
    const version = this.version(row), loaded = this.loaded.get(row.ref);
    return { ref: row.ref, revision: row.version, name: row.data.name, title: version.manifest.notara.title, description: version.manifest.notara.description, version: version.manifest.version, digest: version.digest,
      enabled: row.data.enabled, native: version.native, state: row.data.pending ? 'restart-required' : !row.data.enabled ? 'installed' : loaded?.version.digest === version.digest && loaded.ready() ? 'enabled' : 'failed',
      ...(this.failures.has(row.ref) ? { issue: this.failures.get(row.ref)! } : {}), manifest: version.manifest, ...(version.creation ? { creationRef: version.creation.ref } : {}) };
  }
  list(): PluginView[] { return this.records.list(this.context()).filter(row => row.data.installed).map(row => this.view(row)); }
  active(): { ref: string; version: PluginVersion }[] { return [...this.loaded.entries()].filter(([ref, item]) => item.ready() && this.records.read(this.context(), ref).data.installed).map(([ref, item]) => ({ ref, version: item.version })); }
  get(ref: string, digest: string): PluginVersion {
    const row = this.records.read(this.context(), ref), version = row.data.versions.find(version => version.digest === digest);
    if (!version) throw new Error('plugin_version_missing'); return version;
  }
  body(ref: string, digest: string, entry: string): string { return readPluginText(this.host.studyforgeAccess.root, this.get(ref, digest), entry); }
  private async running(): Promise<boolean> { const sessions = await this.host.sessionController.list({}, AbortSignal.timeout(15_000)); return sessions.items.some(row => row.running); }
  async prepare(source: PluginSource): Promise<PluginCandidate> {
    const version = await preparePackage(this.host.studyforgeAccess.root, source);
    return { candidateId: version.snapshot, manifest: version.manifest, digest: version.digest, native: version.native,
      ...(this.list().find(row => row.name === version.manifest.name) ? { current: this.list().find(row => row.name === version.manifest.name)! } : {}) };
  }
  async candidate(id: string): Promise<PluginVersion> {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('plugin_candidate_invalid');
    const version = PluginVersionSchema.parse(JSON.parse(await readFile(join(pluginRoot(this.host.studyforgeAccess.root), id, 'candidate.json'), 'utf8')));
    if (version.snapshot !== id) throw new Error('plugin_candidate_invalid');
    for (const file of version.files) snapshotFile(this.host.studyforgeAccess.root, version, file.path);
    return version;
  }
  async tagCreation(candidateId: string, creation: NonNullable<PluginVersion['creation']>): Promise<void> {
    const version = await this.candidate(candidateId);
    await writeFile(join(pluginRoot(this.host.studyforgeAccess.root), candidateId, 'candidate.json'), JSON.stringify({ ...version, creation }));
  }
  install(input: { candidateId: string; expectedVersion: number; trustNative: boolean }): Promise<PluginView> {
    return this.serial(async () => {
      const version = await this.candidate(input.candidateId), context = this.context(), ref = 'plugin:' + packageId(version.manifest.name);
      const current = this.records.list(context).find(row => row.ref === ref);
      if (version.native && !input.trustNative) throw new Error('plugin_native_trust_required');
      if (current?.data.installed && current.data.activeDigest === version.digest && current.data.enabled) return this.view(current);
      if (current?.data.installed ? current.version !== input.expectedVersion : input.expectedVersion !== 0) throw new Error('version_conflict');
      if (current?.data.versions.some(old => old.manifest.version === version.manifest.version && old.digest !== version.digest)) throw new Error('plugin_version_reused');
      const pending = (version.native || this.loaded.get(ref)?.version.native) && await this.running();
      const previous = this.loaded.get(ref);
      if (!pending) {
        if (previous) { await previous.dispose(); this.loaded.delete(ref); }
        try { await this.activate(ref, version); }
        catch (error) { if (previous) await this.recover(ref, previous.version); else this.failures.set(ref, '插件未能加载，可重新启用或卸载。'); if (current?.data.installed) throw error; }
      }
      const data = { name: version.manifest.name, installed: true, enabled: true, activeDigest: version.digest,
        versions: current?.data.versions.some(old => old.digest === version.digest) ? current.data.versions : [...(current?.data.versions ?? []), version], ...(pending ? { pending: 'enable' as const } : {}) };
      try {
        const mutation = { ...context, operationId: 'install:' + input.candidateId + ':' + (current?.version ?? 0), expectedVersion: current?.version ?? 0 };
        const saved = current ? await this.records.update(mutation, ref, data, () => data) : await this.records.create(mutation, packageId(version.manifest.name), data);
        this.changed(); return this.view(saved);
      } catch (error) { await this.loaded.get(ref)?.dispose(); this.loaded.delete(ref); if (previous) await this.recover(ref, previous.version); throw error; }
    });
  }
  private async activate(ref: string, version: PluginVersion): Promise<void> {
    for (const item of version.files) snapshotFile(this.host.studyforgeAccess.root, version, item.path);
    const mount = await loadNative(this.host, version); this.loaded.set(ref, { version, ...mount }); this.failures.delete(ref);
  }
  private async recover(ref: string, version: PluginVersion): Promise<void> {
    try { await this.activate(ref, version); } catch { this.failures.set(ref, '更新失败且旧版未能恢复，请检查插件后重新启用，或卸载插件。'); throw new Error('plugin_restore_failed'); }
  }
  setEnabled(input: { ref: string; expectedVersion: number; enabled: boolean }): Promise<PluginView> { return this.change(input.ref, input.expectedVersion, input.enabled ? 'enable' : 'disable'); }
  uninstall(input: { ref: string; expectedVersion: number }): Promise<PluginView> { return this.change(input.ref, input.expectedVersion, 'uninstall'); }
  private change(ref: string, expectedVersion: number, action: 'enable' | 'disable' | 'uninstall'): Promise<PluginView> {
    return this.serial(async () => {
      const context = this.context(), row = this.records.read(context, ref), version = this.version(row);
      if (row.version !== expectedVersion || !row.data.installed) throw new Error('version_conflict');
      const pending = version.native && await this.running();
      if (!pending) {
        await this.loaded.get(ref)?.dispose(); this.loaded.delete(ref); this.failures.delete(ref);
        if (action === 'enable') { try { await this.activate(ref, version); } catch { this.failures.set(ref, '插件未能加载，可重新启用或卸载。'); } }
      }
      const { pending: _pending, ...old } = row.data;
      const data = { ...old, installed: pending || action !== 'uninstall', enabled: pending ? row.data.enabled : action === 'enable', ...(pending ? { pending: action } : {}) };
      const saved = await this.records.update({ ...context, operationId: randomUUID(), expectedVersion }, ref, data, () => data);
      this.changed(); return this.view(saved);
    });
  }
  async restore(): Promise<void> {
    for (let row of this.records.list(this.context()).filter(row => row.data.installed)) {
      if (row.data.pending) {
        const { pending, ...old } = row.data;
        const data = { ...old, installed: pending !== 'uninstall', enabled: pending === 'enable' };
        row = await this.records.update({ ...this.context(), operationId: randomUUID(), expectedVersion: row.version }, row.ref, data, () => data);
      }
      if (!row.data.installed || !row.data.enabled) continue;
      try { await this.activate(row.ref, this.version(row)); } catch { this.failures.set(row.ref, '插件未能恢复，请检查文件后重新启用，或卸载插件。'); }
    }
  }
  async dispose(): Promise<void> { await this.tail; this.closed = true; for (const item of this.loaded.values()) await item.dispose(); this.loaded.clear(); this.listeners.clear(); }
  workbenches(sessionId?: string): WorkbenchChoice[] {
    const active = this.active(), choices = new Map<string, WorkbenchChoice>();
    const add = (ref: string, version: PluginVersion, contributionId?: string): void => {
      for (const item of [...version.manifest.notara.workbenches, ...version.manifest.notara.worldbooks]) {
        if (contributionId && item.id !== contributionId) continue;
        const id = 'plugin-' + ref.slice(7) + '-' + item.id;
        choices.set(id, { id, pluginRef: ref, contributionId: item.id, digest: version.digest, title: item.title, description: item.description });
      }
    };
    for (const { ref, version } of active) add(ref, version);
    // A renamed/removed contribution must remain usable in lessons that pinned
    // it. Disable/uninstall still removes all capabilities for that package.
    if (sessionId) for (const pin of this.pins.list(this.context())) if (pin.data.sessionId === sessionId && active.some(row => row.ref === pin.data.pluginRef)) {
      add(pin.data.pluginRef, this.get(pin.data.pluginRef, pin.data.digest), pin.data.contributionId);
    }
    return [...choices.values()];
  }
  async openWorkbench(sessionId: string, id: string): Promise<WorkbenchContent> {
    const choice = this.workbenches(sessionId).find(item => item.id === id); if (!choice) throw new Error('plugin_not_enabled');
    await this.host.studyforgeAccess.forSession(sessionId);
    const key = packageId(sessionId + ':' + id), context = this.context();
    let pin = this.pins.list(context).find(row => row.ref === 'pluginpin:' + key);
    if (!pin) pin = await this.pins.create({ ...context, operationId: 'pin:' + key }, key, { sessionId, pluginRef: choice.pluginRef, contributionId: choice.contributionId, digest: choice.digest });
    const version = this.get(choice.pluginRef, pin.data.digest), worldbook = version.manifest.notara.worldbooks.find(entry => entry.id === choice.contributionId);
    if (worldbook) return { ...choice, digest: version.digest, title: worldbook.title, kind: 'worldbook', html: '', permissions: ['save-note'] };
    const contribution = version.manifest.notara.workbenches.find(entry => entry.id === choice.contributionId);
    if (!contribution) throw new Error('plugin_workbench_missing');
    return { ...choice, digest: version.digest, title: contribution.title, html: this.body(choice.pluginRef, version.digest, contribution.entry), permissions: contribution.permissions, ...(contribution.document ? { documentKind: contribution.document.kind } : {}) };
  }
}

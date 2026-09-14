import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { RecordStore } from '@studyforge/domain/storage';
import { WorldbookDocumentSchema, type WorldbookRecordSchema, type WorldbookUseSchema, type WorldbookDocument, type WorldbookView, type WorkbenchDraftSchema, type WorkbenchDraftValue, type WorkbenchDraftView, type WorldbookSelection } from '@studyforge/contracts/plugins';
import { packageId } from './plugin-manager.ts';
import { selectWorldbookEntries } from './worldbook-selection.ts';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeWorkbenchData: WorkbenchData } }
/** User-owned content lives outside package snapshots and survives disable/uninstall. */
export class WorkbenchData {
  readonly ctx: Context;
  readonly books: RecordStore<typeof WorldbookRecordSchema>;
  readonly uses: RecordStore<typeof WorldbookUseSchema>;
  readonly drafts: RecordStore<typeof WorkbenchDraftSchema>;
  constructor(ctx: Context, books: RecordStore<typeof WorldbookRecordSchema>, uses: RecordStore<typeof WorldbookUseSchema>, drafts: RecordStore<typeof WorkbenchDraftSchema>) { this.ctx = ctx; this.books = books; this.uses = uses; this.drafts = drafts; }
  private context(sessionId: string) { return { ...this.ctx.studyforgePluginsManager.context(), sessionId }; }
  private async book(sessionId: string, id: string) {
    const content = await this.ctx.studyforgePluginsManager.openWorkbench(sessionId, id);
    if (content.kind !== 'worldbook') throw new Error('plugin_worldbook_required');
    return content;
  }
  async readWorldbook(sessionId: string, id: string): Promise<WorldbookView> {
    const content = await this.book(sessionId, id), context = this.context(sessionId);
    const row = this.books.list(context).find(row => row.data.id === id);
    const use = this.uses.list(context).find(row => row.data.id === id && row.data.sessionId === sessionId);
    const version = this.ctx.studyforgePluginsManager.get(content.pluginRef, content.digest);
    const source = version.manifest.notara.worldbooks.find(item => item.id === content.contributionId)!;
    const document = row?.data.document ?? WorldbookDocumentSchema.parse(JSON.parse(this.ctx.studyforgePluginsManager.body(content.pluginRef, content.digest, source.entry)));
    return { document, revision: row?.version ?? 0, enabled: use?.data.enabled ?? false, useRevision: use?.version ?? 0 };
  }
  async saveWorldbook(input: { sessionId: string; id: string; expectedVersion: number; operationId: string; document: WorldbookDocument }): Promise<WorldbookView> {
    await this.book(input.sessionId, input.id);
    const context = { ...this.context(input.sessionId), expectedVersion: input.expectedVersion, operationId: input.operationId };
    const data = { id: input.id, document: WorldbookDocumentSchema.parse(input.document) }, key = packageId(input.id);
    if (input.expectedVersion === 0) await this.books.create(context, key, data);
    else await this.books.update(context, 'worldbook:' + key, data, () => data);
    return this.readWorldbook(input.sessionId, input.id);
  }
  async useWorldbook(input: { sessionId: string; id: string; expectedVersion: number; enabled: boolean }): Promise<WorldbookView> {
    await this.book(input.sessionId, input.id);
    const context = { ...this.context(input.sessionId), expectedVersion: input.expectedVersion, operationId: randomUUID() };
    const data = { sessionId: input.sessionId, id: input.id, enabled: input.enabled }, key = packageId(input.sessionId + ':' + input.id);
    if (input.expectedVersion === 0) await this.uses.create(context, key, data);
    else await this.uses.update(context, 'worldbookuse:' + key, data, () => data);
    return this.readWorldbook(input.sessionId, input.id);
  }
  async preview(sessionId: string, id: string, query: string): Promise<WorldbookSelection> {
    const content = await this.book(sessionId, id), row = await this.readWorldbook(sessionId, id);
    return selectWorldbookEntries([{ title: content.title, entries: row.document.entries }], query);
  }
  async background(sessionId: string, query: string): Promise<string> {
    const context = this.context(sessionId), choices = this.ctx.studyforgePluginsManager.workbenches(sessionId);
    const active = this.uses.list(context).filter(row => row.data.sessionId === sessionId && row.data.enabled && choices.some(item => item.id === row.data.id));
    const books: { title: string; entries: WorldbookDocument['entries'] }[] = [];
    for (const use of active) {
      const view = await this.readWorldbook(sessionId, use.data.id);
      const content = await this.book(sessionId, use.data.id);
      books.push({ title: content.title, entries: view.document.entries });
    }
    return selectWorldbookEntries(books, query).text;
  }
  private async draftTarget(sessionId: string, id: string, digest: string) {
    const workbench = await this.ctx.studyforgePluginsManager.openWorkbench(sessionId, id);
    if (workbench.digest !== digest || !workbench.permissions.includes('draft')) throw new Error('plugin_draft_not_allowed');
    return packageId(sessionId + ':' + id + ':' + digest);
  }
  async readDraft(sessionId: string, id: string, digest: string): Promise<WorkbenchDraftView> {
    const key = await this.draftTarget(sessionId, id, digest);
    const row = this.drafts.list(this.context(sessionId)).find(row => row.ref === 'workbenchdraft:' + key);
    return { revision: row?.version ?? 0, json: JSON.stringify(row?.data.value ?? null) };
  }
  async saveDraft(input: { sessionId: string; id: string; digest: string; expectedVersion: number; operationId: string; value: WorkbenchDraftValue }): Promise<WorkbenchDraftView> {
    const key = await this.draftTarget(input.sessionId, input.id, input.digest);
    const context = { ...this.context(input.sessionId), expectedVersion: input.expectedVersion, operationId: input.operationId };
    const data = { sessionId: input.sessionId, id: input.id, digest: input.digest, value: input.value };
    const row = input.expectedVersion === 0 ? await this.drafts.create(context, key, data) : await this.drafts.update(context, 'workbenchdraft:' + key, data, () => data);
    return { revision: row.version, json: JSON.stringify(row.data.value) };
  }
}

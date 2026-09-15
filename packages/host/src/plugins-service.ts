import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { PluginSourceSchema, WorkbenchNoteSchema, WorldbookDocumentSchema, WorkbenchDraftValueSchema, type WorldbookDocument, type WorldbookView, type WorldbookSelection, type WorkbenchDraftView, type PluginSource, type PluginCandidate, type PluginView, type WorkbenchChoice, type WorkbenchContent } from '@studyforge/contracts/plugins';
import { studentContext } from './learning-service.ts';
import type { CardView } from '@studyforge/contracts/cards';
import { legacyPlugins, changeLegacyPlugin } from './plugins/legacy-artifacts.ts';
import { documentLinks } from './plugins/learning-workbenches.ts';

const Target = z.object({ ref: z.string().regex(/^(?:plugin|legacy):[a-f0-9]{24}$/), expectedVersion: z.number().int().nonnegative() }).strict();
const WorkbenchTarget = z.object({ sessionId: z.string().min(1), id: z.string().min(1) }).strict();
const Revision = z.number().int().nonnegative();
declare module '@deepseek-ai/cordis' { interface Context { studyforgePlugins: StudyForgePlugins } }
export class StudyForgePlugins extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgePlugins'); }
  @Remote('prepare')
  async prepare(input: PluginSource): Promise<PluginCandidate> { return this.ctx.studyforgePluginsManager.prepare(PluginSourceSchema.parse(input)); }
  @Remote('installPackage')
  async installPackage(input: { candidateId: string; expectedVersion: number; trustNative: boolean }): Promise<PluginView> {
    return this.ctx.studyforgePluginsManager.install(z.object({ candidateId: z.string(), expectedVersion: z.number().int().nonnegative(), trustNative: z.boolean() }).strict().parse(input));
  }
  @Remote('list')
  async list(): Promise<PluginView[]> { return [...this.ctx.studyforgePluginsManager.list(), ...legacyPlugins(this.ctx)]; }
  @Remote('setEnabled')
  async setEnabled(input: { ref: string; expectedVersion: number; enabled: boolean }): Promise<PluginView> { const data = Target.extend({ enabled: z.boolean() }).parse(input); return data.ref.startsWith('legacy:') ? changeLegacyPlugin(this.ctx, data, data.enabled) : this.ctx.studyforgePluginsManager.setEnabled(data); }
  @Remote('uninstallPackage')
  async uninstallPackage(input: { ref: string; expectedVersion: number }): Promise<PluginView> { const data = Target.parse(input); return data.ref.startsWith('legacy:') ? changeLegacyPlugin(this.ctx, data, false, true) : this.ctx.studyforgePluginsManager.uninstall(data); }
  @Remote('workbenches')
  async workbenches(input?: { sessionId: string }): Promise<WorkbenchChoice[]> {
    if (input) { const data = z.object({ sessionId: z.string().min(1) }).strict().parse(input); await studentContext(this.ctx, data.sessionId); }
    return this.ctx.studyforgePluginsManager.workbenches(input?.sessionId);
  }
  @Remote('openWorkbench')
  async openWorkbench(input: { sessionId: string; id: string }): Promise<WorkbenchContent> {
    const data = z.object({ sessionId: z.string().min(1), id: z.string().min(1) }).strict().parse(input);
    await studentContext(this.ctx, data.sessionId); return this.ctx.studyforgePluginsManager.openWorkbench(data.sessionId, data.id);
  }
  @Remote('readWorldbook')
  async readWorldbook(input: { sessionId: string; id: string }): Promise<WorldbookView> {
    const data = WorkbenchTarget.parse(input); await studentContext(this.ctx, data.sessionId);
    return this.ctx.studyforgeWorkbenchData.readWorldbook(data.sessionId, data.id);
  }
  @Remote('saveWorldbook')
  async saveWorldbook(input: { sessionId: string; id: string; expectedVersion: number; operationId: string; document: WorldbookDocument }): Promise<WorldbookView> {
    const data = WorkbenchTarget.extend({ expectedVersion: Revision, operationId: z.string().min(1).max(160), document: WorldbookDocumentSchema }).parse(input);
    await studentContext(this.ctx, data.sessionId); return this.ctx.studyforgeWorkbenchData.saveWorldbook(data);
  }
  @Remote('useWorldbook')
  async useWorldbook(input: { sessionId: string; id: string; expectedVersion: number; enabled: boolean }): Promise<WorldbookView> {
    const data = WorkbenchTarget.extend({ expectedVersion: Revision, enabled: z.boolean() }).parse(input);
    await studentContext(this.ctx, data.sessionId);
    const result = await this.ctx.studyforgeWorkbenchData.useWorldbook(data);
    if (result.document.classroom) await this.ctx.notaraClassroom.setUse(data.sessionId, data.id, data.enabled);
    return result;
  }
  @Remote('previewWorldbook')
  async previewWorldbook(input: { sessionId: string; id: string; query: string }): Promise<WorldbookSelection> {
    const data = WorkbenchTarget.extend({ query: z.string().max(4000) }).parse(input); await studentContext(this.ctx, data.sessionId);
    return this.ctx.studyforgeWorkbenchData.preview(data.sessionId, data.id, data.query);
  }
  @Remote('readDraft')
  async readDraft(input: { sessionId: string; id: string; digest: string }): Promise<WorkbenchDraftView> {
    const data = WorkbenchTarget.extend({ digest: z.string() }).parse(input); await studentContext(this.ctx, data.sessionId);
    return this.ctx.studyforgeWorkbenchData.readDraft(data.sessionId, data.id, data.digest);
  }
  @Remote('saveDraft')
  async saveDraft(input: { sessionId: string; id: string; digest: string; expectedVersion: number; operationId: string; json: string }): Promise<WorkbenchDraftView> {
    const data = WorkbenchTarget.extend({ digest: z.string(), expectedVersion: Revision, operationId: z.string().min(1).max(160), json: z.string().max(64_000) }).parse(input);
    const { json, ...target } = data;
    await studentContext(this.ctx, data.sessionId); return this.ctx.studyforgeWorkbenchData.saveDraft({ ...target, value: WorkbenchDraftValueSchema.parse(JSON.parse(json)) });
  }
  @Remote('saveNote')
  async saveNote(input: { sessionId: string; id: string; digest: string; operationId: string; note: { title: string; body: string; documentRevision?: number } }): Promise<CardView> {
    const data = z.object({ sessionId: z.string().min(1), id: z.string(), digest: z.string(), operationId: z.string().min(1), note: WorkbenchNoteSchema }).strict().parse(input);
    const context = await studentContext(this.ctx, data.sessionId), workbench = await this.ctx.studyforgePluginsManager.openWorkbench(data.sessionId, data.id);
    if (workbench.digest !== data.digest || !workbench.permissions.includes('save-note')) throw new Error('plugin_save_not_allowed');
    const document = workbench.documentKind ? await this.ctx.studyforgeLearningWorkbenches.read(context, data.id) : undefined;
    if (workbench.documentKind === 'math' && data.note.documentRevision === undefined || data.note.documentRevision !== undefined && data.note.documentRevision !== document?.revision) throw new Error('workbench_note_stale');
    const links = document ? documentLinks(document.document) : [];
    const result = await this.ctx.studyforgeCardService.create({ ...context, operationId: 'plugin-note:' + data.sessionId + ':' + data.id + ':' + data.operationId }, { title: data.note.title, presentation: 'note', front: data.note.body, sources: links.flatMap(link => link.kind === 'source' ? [link.source] : []), links: links.flatMap(link => link.kind === 'card' ? [link.ref] : []) });
    this.ctx.notaraClassroom?.noteSaved(data.sessionId);
    return result;
  }
}

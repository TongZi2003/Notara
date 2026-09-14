import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { PluginSourceSchema, WorkbenchNoteSchema, type PluginSource, type PluginCandidate, type PluginView, type WorkbenchChoice, type WorkbenchContent } from '@studyforge/contracts/plugins';
import { studentContext } from './learning-service.ts';
import type { CardView } from '@studyforge/contracts/cards';
import { legacyPlugins, changeLegacyPlugin } from './plugins/legacy-artifacts.ts';

const Target = z.object({ ref: z.string().regex(/^(?:plugin|legacy):[a-f0-9]{24}$/), expectedVersion: z.number().int().nonnegative() }).strict();
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
  async workbenches(): Promise<WorkbenchChoice[]> { return this.ctx.studyforgePluginsManager.workbenches(); }
  @Remote('openWorkbench')
  async openWorkbench(input: { sessionId: string; id: string }): Promise<WorkbenchContent> {
    const data = z.object({ sessionId: z.string().min(1), id: z.string().min(1) }).strict().parse(input);
    await studentContext(this.ctx, data.sessionId); return this.ctx.studyforgePluginsManager.openWorkbench(data.sessionId, data.id);
  }
  @Remote('saveNote')
  async saveNote(input: { sessionId: string; id: string; digest: string; operationId: string; note: { title: string; body: string } }): Promise<CardView> {
    const data = z.object({ sessionId: z.string().min(1), id: z.string(), digest: z.string(), operationId: z.string().min(1), note: WorkbenchNoteSchema }).strict().parse(input);
    const context = await studentContext(this.ctx, data.sessionId), workbench = await this.ctx.studyforgePluginsManager.openWorkbench(data.sessionId, data.id);
    if (workbench.digest !== data.digest || !workbench.permissions.includes('save-note')) throw new Error('plugin_save_not_allowed');
    return this.ctx.studyforgeCardService.create({ ...context, operationId: 'plugin-note:' + data.sessionId + ':' + data.id + ':' + data.operationId }, { title: data.note.title, presentation: 'note', front: data.note.body });
  }
}

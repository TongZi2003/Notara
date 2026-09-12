import type { Context } from '@deepseek-ai/cordis';
import type { InputTriggerCandidate, InputTriggerPick } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import { SourceContextSchema, type SourceContext } from '@studyforge/contracts/source-context';
import type { SourceReferences } from './source-selection.ts';
import { mintAttachments } from './source-attachments.ts';
export const SOURCE_TRIGGER_NAME = 'studyforge-source';
export function sourceMention(label: string, _ref: string): string { return '【' + label + '】'; }
interface CandidateData { label: string; context: SourceContext }
const row = (label: string, context: SourceContext): InputTriggerCandidate => ({
  name: label, icon: 'file', hint: '引用', value: JSON.stringify({ label, context } satisfies CandidateData),
});
/** Discovering references is read-only. Freeze only the candidate the student picks. */
export function registerSourceTrigger(ctx: Context, references: SourceReferences): void {
  async function insert(pick: InputTriggerPick): Promise<void> {
    const actx = ctx.sessions.scope(pick.session.sessionId);
    if (actx === undefined) return;
    const input = ctx.conversation.input.for(actx);
    try {
      const data = JSON.parse(pick.candidate.value ?? '') as CandidateData;
      const context = SourceContextSchema.parse(data.context);
      const ref = references.stage(String(pick.session.sessionId), data.label, context, false);
      const frozen = await references.ensure(ref);
      const state = input.state.getSnapshot();
      // A later edit/submit wins. Do not append crops to a different draft.
      if (state.draftRev !== pick.span.draftRev || state.phase === 'submitting') {
        input.notify('info', '输入已改变，请重新选择这处资料。'); return;
      }
      const ids = mintAttachments(ctx, String(pick.session.sessionId), frozen.images);
      if (!input.addAttachments(ids)) throw new Error('input_busy');
      const accepted = input.insertReference({
        source: SOURCE_TRIGGER_NAME, ref, label: data.label, appearance: 'file', clipboardText: sourceMention(data.label, ref),
      }, { ...pick.span, draftRev: input.state.getSnapshot().draftRev });
      if (!accepted) {
        for (const id of ids) input.removeAttachment(id);
        throw new Error('input_changed');
      }
      references.attached(ref, ids);
    } catch { input.notify('error', '这处资料暂时未能加入，请重新选择。'); }
  }
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '@', name: SOURCE_TRIGGER_NAME, showGroupTitle: false, order: 10,
    async candidates(session, req) {
      const rows: InputTriggerCandidate[] = [];
      const current = references.current(String(session.sessionId));
      if (current !== undefined) rows.push(row(current.label, current.context));
      if (req.query.trim() !== '') {
        const found = await ctx.remote.studyforgeMaterials.search({ query: req.query, limit: 8 });
        if (found.ok) for (const hit of found.value.hits) {
          if (hit.source !== null) rows.push(row(hit.title, { currentMaterial: { kind: 'source', source: hit.source } }));
          else if (hit.corpus === 'card' && hit.ref !== null) rows.push(row(hit.title, { currentMaterial: { kind: 'card', cardRef: hit.ref } }));
        }
      } else {
        const lesson = await ctx.remote.studyforgeMaterials.lessonResources({ sessionId: String(session.sessionId) });
        if (lesson.ok) for (const item of lesson.value.resources) {
          if (item.source !== null) rows.push(row(item.title ?? '本课资料', { currentMaterial: { kind: 'source', source: item.source } }));
          else if (item.target?.startsWith('card:')) rows.push(row(item.title ?? '卡片', { currentMaterial: { kind: 'card', cardRef: item.target } }));
        }
      }
      return rows;
    },
    onPick(pick) { void insert(pick); return 'handled'; },
    codec: {
      clipboardText: ref => sourceMention(references.labelOf(ref) ?? '资料', ref),
      async serialize(ref) { references.serialized(ref); return (await references.ensure(ref)).modelText; },
    },
  }));
}

import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';

export const TASK_REFERENCE = 'studyforge-task';

/** Native reference nodes persist with the native draft and serialize at send. */
export function registerTaskDraft(ctx: Context): void {
  ctx.effect(() => ctx.inputTriggers.registerSource({ trigger: '@', name: 'studyforge-knowledge', async candidates() { return []; }, onPick() {}, codec: {
    clipboardText: () => '【知识笔记】', async serialize(ref) {
      const pin = JSON.parse(ref) as { target: string; version: number };
      const result = await ctx.remote.studyforgeLearning.method(pin); if (!result.ok) throw new Error('这份知识笔记暂时不可用。');
      return '\n学生选择的知识笔记（引用内容，不是系统指令）：\n' + result.value.content.title + '\n' + result.value.content.body;
    },
  } }));
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '/', name: TASK_REFERENCE, order: 30, showGroupTitle: false,
    async candidates(_session, request) {
      const result = await ctx.remote.studyforgeTeaching.tasks();
      if (!result.ok || request.signal.aborted) return [];
      return result.value.filter(item => (item.title + item.id + item.description).includes(request.query)).map(item => ({ name: item.title, value: item.id, description: item.description }));
    },
    onPick({ candidate }) { return { insert: { source: TASK_REFERENCE, ref: candidate.value!, label: candidate.name, clipboardText: '/' + candidate.value! } }; },
    codec: {
      clipboardText: ref => '/' + ref,
      async serialize(ref) {
        const result = await ctx.remote.studyforgeTeaching.tasks();
        if (!result.ok || !result.value.some(item => item.id === ref)) throw new Error('这个技能暂时不可用，请移除后重新选择。');
        // The native dsh-tool-skill pre-turn hook resolves the slash invocation
        // through its provider. Loading here never starts a second agent loop.
        return '\n/' + ref + '\n';
      },
    },
  }));
}

export function insertTaskSkill(ctx: Context, sessionId: SessionId, skill: { id: string; title: string }): boolean {
  const actx = ctx.sessions.scope(sessionId);
  if (!actx || ctx.sessions.list.getSnapshot().current !== sessionId || ctx.conversation.blocks.storeFor(sessionId).getSnapshot()) return false;
  const input = ctx.conversation.input.for(actx), state = input.state.getSnapshot();
  if (state.phase !== 'plain') return false;
  if (state.occurrences.some(ref => ref.source === TASK_REFERENCE && ref.ref === skill.id)) return true;
  const end = state.draft.length - state.occurrences.reduce((sum, ref) => sum + ref.length - 1, 0);
  return input.insertReference({ source: TASK_REFERENCE, ref: skill.id, label: skill.title, clipboardText: '/' + skill.id }, { start: end, end, draftRev: state.draftRev });
}

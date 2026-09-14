import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { Message } from '@deepseek-ai/dsh-llm';
import type { BookBreakdownIntent } from '@studyforge/contracts/book-exploration';
import type { CardContent, HostContext } from '@studyforge/contracts';
import { decodeSourceFragments } from '@studyforge/contracts/source-context';
import { validateBookBreakdown } from '@studyforge/domain/book-exploration';

/** A later real user message replaces the task; receipts and tool results do not.
 * Read only the native cut preceding this call, so a later queued task cannot reparent it. */
export function currentBookTask(events: readonly SessionEvent[], callId?: string): BookBreakdownIntent | undefined {
  let task: BookBreakdownIntent | undefined;
  const pending: Record<'next-step' | 'next-turn', Message[]> = { 'next-step': [], 'next-turn': [] };
  const accept = (message: Message): void => {
    if (message.role !== 'user' || message.source.kind !== 'user') return;
    const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
    task = decodeSourceFragments(text).fragments.findLast(fragment => fragment.bookTask !== undefined)?.bookTask;
  };
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.callId === callId) break;
    if (event.type === 'user/message') accept(event.data);
    if (event.type === 'agent/inbox/spliced' && callId === undefined) {
      const splice = event.data;
      const claimed = pending[splice.target].splice(splice.start, splice.removedCount ?? 0, ...splice.inserted);
      // Prompt assembly precedes user/message admission. Only claimed input
      // participates; another queued or canceled request cannot replace it.
      if (!splice.outcome && splice.inserted.length === 0) for (const message of claimed) accept(message);
    }
  }
  return task;
}

export function bookTaskInstructions(task: BookBreakdownIntent): string {
  return [
    `本次节点操作：${task.action === 'cards' ? '拆成题卡' : '细分目录'}。目标：${task.nodePath ?? '书根'}。`,
    '固定原件与完整范围：' + JSON.stringify({ material: task.material, sources: task.sources }),
    task.action === 'cards'
      ? '先用list_cards按materialId和chapter检查已有卡，再read_material逐题读取上述原文范围。同批读清的题卡放进一次propose_card(kind=cards, title, cards)调用，学生可勾选后一起批准；不要逐题调用propose_card。sources必须准确指向这个原件版本，chapter省略时Host挂回所选章节。不要改成讲解、测验或另排目录，不用register_cards绕过确认。可用原生subagent帮忙读取、分题，只把已读材料和制卡要求交给它；它返回草稿，由你核对后合成一批提案。'
      : '读取已有目录和范围内原文，用propose_skeleton提出有用的下一层目录，保持其他分支。只看目录得到的父节点detail=outline，读清并细化的实际片段detail=refined；父章节整段不代表全章整理完成。',
    '这里只授权准备提案；学生确认后才保存。不要因为保存回执切换活动。',
  ].join('\n');
}

/** Bind before the proposal is frozen. Confirmation keeps this content even if UI focus moves. */
export async function bindTaskCard(host: Context, execution: ToolRunContext, context: HostContext, content: CardContent): Promise<CardContent> {
  const task = execution.agent && currentBookTask(execution.agent.session.snapshotEvents(), execution.callId);
  if (!task || task.action !== 'cards') return content;
  const structure = await host.studyforgeBookExploration.read(context, task.material);
  validateBookBreakdown(structure, task);
  const versions = new Set(task.sources.length ? task.sources.map(source => source.versionId) : [task.material.versionId]);
  if (!content.sources.length || content.sources.some(source => source.materialId !== task.material.materialId || !versions.has(source.versionId))) {
    throw new Error('本次从选中的章节拆卡，请给每道原题补上该书固定版本的准确来源，再提交提案。');
  }
  if (task.nodePath && content.chapter && content.chapter !== task.nodePath && !content.chapter.startsWith(task.nodePath + '/')) {
    throw new Error('这张卡的章节不在本次所选节点下，请使用所选章节或已有子章节。');
  }
  const bound = { ...content, ...(task.nodePath && !content.chapter ? { chapter: task.nodePath } : {}) };
  await host.studyforgeCardService.check(context, bound);
  return bound;
}

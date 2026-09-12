import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SessionId } from '@deepseek-ai/dsh-session';
import { CardViewSchema, CardBatchReadResultSchema } from '@studyforge/contracts/cards';
import { KnowledgeViewSchema } from '@studyforge/contracts/knowledge';
import type { MutationContext } from '@studyforge/contracts';
import { z } from 'zod';
import { MemoryViewSchema } from '@studyforge/contracts/memory';

export async function teacherContext(host: Context, execution: ToolRunContext): Promise<MutationContext> {
  if (!execution.agent) throw new Error('learning_session_required');
  const binding = await host.studyforgeAccess.forSession(execution.agent.session.id);
  if (binding.purpose !== 'learning') throw new Error('learning_session_required');
  return { workspaceId: binding.workspaceId, sessionId: binding.sessionId, actor: 'teacher', purpose: 'learning',
    operationId: `native:${binding.sessionId}:${execution.callId}:${execution.name}` };
}

/** Recover the actual revision last shown to this native model before its edit
 * call. The model neither invents a token nor silently adopts a concurrent edit. */
export async function observedVersion(host: Context, execution: ToolRunContext, target: string): Promise<number> {
  if (!execution.agent) throw new Error('learning_session_required');
  const observation = await host.sessionQuery.observeSession(SessionId(execution.agent.session.id));
  try {
    const cutoff = observation.events.findIndex(event => event.type === 'tool/call' && event.data.callId === execution.callId);
    if (cutoff < 0) throw new Error('缺少原生工具调用记录，请重新读取对象后修改。');
    const calls = new Map<string, string>();
    let version: number | undefined;
    for (const event of observation.events.slice(0, cutoff)) {
      if (event.type === 'tool/call') calls.set(event.data.callId, event.data.name);
      if (event.type !== 'tool/result') continue;
      const result = event.data.message.content[0];
      const name = calls.get(result.toolCallId);
      if (result.isError || !name || !['read_card', 'read_cards', 'update_card', 'read_method', 'note_method', 'revise_method', 'read_set', 'read_plan', 'read_route', 'read_skeleton', 'read_memory', 'note_memory', 'revise_memory', 'read_lesson'].includes(name)) continue;
      for (const block of result.content) {
        if (block.type !== 'text') continue;
        try {
          const value: unknown = JSON.parse(block.text);
          if (name === 'read_cards') {
            const batch = CardBatchReadResultSchema.safeParse(value);
            const card = batch.success ? batch.data.cards.find(card => card.ref === target) : undefined;
            if (card) version = card.version;
            continue;
          }
          if (target.startsWith('memory:')) {
            const memory = MemoryViewSchema.safeParse(value);
            if (memory.success && memory.data.ref === target) version = memory.data.revision;
            continue;
          }
          if (name === 'read_skeleton') {
            const skeleton = z.object({ materialId: z.string(), revision: z.number().int().nonnegative().optional() }).safeParse(value);
            if (skeleton.success && target === 'skeleton:' + skeleton.data.materialId) version = skeleton.data.revision ?? 0;
            continue;
          }
          const parsed = target.startsWith('card:') ? CardViewSchema.safeParse(value) : target.startsWith('knowledge:') ? KnowledgeViewSchema.safeParse(value)
            : z.object({ ref: z.string(), version: z.number().int().nonnegative() }).safeParse(value);
          if (parsed.success && parsed.data.ref === target) version = parsed.data.version;
        } catch { /* Non-JSON tool text is not an object read. */ }
      }
    }
    if (version === undefined) throw new Error('请先用对应读取工具查看这个对象，再修改。');
    return version;
  } finally { observation[Symbol.dispose](); }
}

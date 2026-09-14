import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Message } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';

/** Assembly precedes admission: accept claimed inputs, never the tail of the queue. */
export function worldbookInput(events: readonly SessionEvent[]): { id: string; text: string } | undefined {
  let current: { id: string; text: string } | undefined;
  const pending: Record<'next-step' | 'next-turn', Message[]> = { 'next-step': [], 'next-turn': [] };
  const accept = (message: Message): void => {
    if (message.role === 'user' && message.source.kind === 'user') current = { id: message.id, text: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') };
  };
  for (const event of events) {
    if (event.type === 'turn/start') current = undefined;
    if (event.type === 'user/message') accept(event.data);
    if (event.type === 'agent/inbox/spliced') {
      const splice = event.data, claimed = pending[splice.target].splice(splice.start, splice.removedCount ?? 0, ...splice.inserted);
      if (!splice.outcome && splice.inserted.length === 0) for (const message of claimed) accept(message);
    }
  }
  return current;
}
export function worldbookContext(host: Context): (agent: Agent) => Promise<string> {
  const cache = new WeakMap<Agent, { id: string; text: Promise<string> }>();
  return async agent => {
    const input = worldbookInput(agent.session.snapshotEvents()); if (!input) return '';
    const old = cache.get(agent); if (old?.id === input.id) return old.text;
    const text = host.studyforgeWorkbenchData.background(agent.session.id, input.text);
    cache.set(agent, { id: input.id, text });
    try { return await text; } catch (error) { cache.delete(agent); throw error; }
  };
}

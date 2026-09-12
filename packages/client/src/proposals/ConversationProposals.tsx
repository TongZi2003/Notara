import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import type { ConversationMatch, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { ProposalViewSchema } from '@studyforge/contracts/proposals';
import { ProposalInbox } from './ProposalInbox.tsx';

type ProposalCall = { id: string; seq: number };
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap { 'studyforge-proposals': readonly ProposalCall[]; }
}
function proposalCall(match: ConversationMatch): ProposalCall[] {
  if (match.event.type !== 'tool/result') return [];
  const result = match.event.data.message.content[0];
  if (result.isError) return [];
  for (const block of result.content) {
    if (block.type !== 'text') continue;
    try {
      const parsed = ProposalViewSchema.safeParse(JSON.parse(block.text));
      if (parsed.success && parsed.data.origin.kind === 'native' && parsed.data.origin.callId === result.toolCallId) return [{ id: result.toolCallId, seq: match.event.seq }];
    } catch { /* Ordinary tool output is not a proposal. */ }
  }
  return [];
}
/** Derived only from native tool results; latest editable content stays in Host. */
const proposalTurns: ConversationNodeDefinition<readonly ProposalCall[]> = {
  kind: 'studyforge-proposals',
  match: event => event.type === 'turn/start' ? { id: String(event.data.turn), role: 'start' }
    : event.type === 'tool/result' ? { id: String(event.data.turn), role: 'update' } : null,
  start: () => [],
  update: (context, match) => {
    const calls = proposalCall(match);
    return calls.length ? [...context.state, ...calls] : context.state;
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn') return null;
    const calls = context.state ?? context.matches.flatMap(proposalCall);
    if (previous?.kind === 'turn' && previous.key === 'studyforge-proposals' && JSON.stringify(previous.value) === JSON.stringify(calls)) return previous;
    return { kind: 'turn', turn: Number(context.id), key: 'studyforge-proposals', value: calls };
  },
};

/** Use the native reply extension; never redeclare the chat owner's child slots. */
export function registerConversationProposals(ctx: Context): void {
  ctx.effect(() => ctx.uiConversation.events.register(proposalTurns));
  function TurnProposals({ sessionId, useSessions, matched }: PropsRuntime<'conversation.chat.turnTail'> & { matched: readonly string[] }): React.JSX.Element | null {
    const preset = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset);
    const running = useSessions(state => state.byId[sessionId]?.running);
    if (preset !== 'studyforge-learning') return null;
    return <ProposalInbox ctx={ctx} sessionId={String(sessionId)} callIds={matched} inline refreshToken={running ? 'running' : 'settled'} />;
  }
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', priority: -20,
    select: owner => {
      const ids = (owner.turn.data.get('studyforge-proposals') ?? []).filter(call => call.seq <= owner.seq).map(call => call.id);
      return ids.length ? ids : null;
    },
  }, TurnProposals)));
}

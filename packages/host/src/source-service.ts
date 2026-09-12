import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { SourceContext, FrozenSource } from '@studyforge/contracts/source-context';
import { freezeSourceContext } from './runtime/context-envelope.ts';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeSources: StudyForgeSources; } }

/** Source serialization only. The native input owner still accepts and sends. */
export class StudyForgeSources extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeSources'); }
  @Remote('freeze')
  async freeze(input: { sessionId: string; context: SourceContext }): Promise<FrozenSource> {
    return freezeSourceContext(this.ctx, input.sessionId, input.context, this.ctx.get('studyforgeCardContext'));
  }
}

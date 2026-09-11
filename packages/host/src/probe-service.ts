import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { ProbeReply, ProbeService } from '@studyforge/contracts/probe';

declare module '@deepseek-ai/cordis' {
  interface Context {
    studyforgeProbe: StudyForgeProbe;
  }
}

/** The only P0 Host behavior: echo through the native Remote boundary. */
export class StudyForgeProbe extends TypertRemoteService implements ProbeService {
  constructor(ctx: Context) {
    super(ctx, 'studyforgeProbe');
  }

  @Remote('inspect')
  async inspect(input: { nonce: string }): Promise<ProbeReply> {
    console.info(`studyforge-probe ${JSON.stringify({ nonce: input.nonce })}`);
    return { workspaceLabel: '空学习空间', echoedNonce: input.nonce };
  }
}

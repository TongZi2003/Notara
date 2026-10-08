import { checkpointTiersProjection, checkpointSurfaceMatches } from './context-memory-tiers.js';
import { projectNativeSpan, verifyNativeSpanCoverage } from './context-memory-span.js';
import { prepareBoundedCompression } from './context-memory-kernel.js';

/** Shared native history, transaction-local Billion core: no second compression loop. */
export class NativeContextMemory {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.sessionProjections.register(checkpointTiersProjection);
  }

  prepare(input, agent) {
    const state = this.ctx.sessionProjections.stateOf(agent.session, checkpointTiersProjection.key);
    if (!checkpointSurfaceMatches(state, agent.session.surface.nodes)) {
      throw new Error('context memory: native tier projection is stale');
    }
    const checkpoints = new Map(state.checkpoints.map(row => [row.seq, row]));
    const projected = projectNativeSpan(input, { checkpointTier: (seq, compactionId) => {
      const row = checkpoints.get(seq);
      return row?.compactionId === compactionId ? row : undefined;
    } });
    const tier = projected.tier;
    return {
      tier,
      verify(summary) {
        if (summary.some(block => block.type !== 'text')) throw new Error('context memory: expected text checkpoint');
        const text = summary.map(block => block.text).join('\n');
        const plan = prepareBoundedCompression(projected.atoms, projected.kernelSelection, text);
        if (plan.tier !== tier) throw new Error('context memory: unexpected compression tier');
        // Each alias covers whole, balanced native events; original content is
        // independently consumed by the serial summarizer, never these labels.
        return verifyNativeSpanCoverage(projected, plan);
      },
    };
  }
}

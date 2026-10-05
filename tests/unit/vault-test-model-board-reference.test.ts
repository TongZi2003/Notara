import {describe, expect, it} from 'vitest';
import {VAULT_BOARD_REFERENCE_REPLY_KEY, VAULT_SOLVER_REPLY_KEY, scriptedReplyEntry} from '../../scripts/fixtures/vault-test-model.js';

describe('Native Vault synthetic board-reference replies', () => {
  const fallback = {text: 'receipt fallback'};
  const route = {workerPreset: undefined, solverRoute: false, hasPurpose: false};

  it('uses the dedicated fallback only for a genuine serialized receipt', () => {
    const replies = {[VAULT_BOARD_REFERENCE_REPLY_KEY]: fallback};
    expect(scriptedReplyEntry(replies, '〔白板选区:550e8400-e29b-41d4-a716-446655440000〕 target', route)).toEqual(fallback);
    expect(scriptedReplyEntry(replies, '请继续完善另一块白板。', route)).toBeUndefined();
    expect(scriptedReplyEntry(replies, '〔白板选区:550e8400-e29b-41d4-a716-446655440000〕 target', {...route, hasPurpose: true})).toBeUndefined();
  });

  it('keeps exact, worker, and solver replies ahead of the receipt fallback', () => {
    const exact = {text: 'exact prompt'};
    const worker = {text: 'worker prompt'};
    const solver = {text: 'solver prompt'};
    const prompt = '〔白板选区:550e8400-e29b-41d4-a716-446655440000〕 target';
    const replies = {
      [VAULT_BOARD_REFERENCE_REPLY_KEY]: fallback,
      [prompt]: exact,
      '__worker:lesson': worker,
      [VAULT_SOLVER_REPLY_KEY]: solver,
    };
    expect(scriptedReplyEntry(replies, prompt, route)).toEqual(exact);
    expect(scriptedReplyEntry(replies, prompt, {...route, workerPreset: 'lesson', solverRoute: true})).toEqual(worker);
    expect(scriptedReplyEntry(replies, prompt, {...route, solverRoute: true})).toEqual(solver);
  });
});

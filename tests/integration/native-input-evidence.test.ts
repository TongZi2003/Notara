/**
 * P2.3 evidence projection over a real native Session log.
 *
 * The only substitute is the model backend: the harness registers one scripted
 * `LlmAdapter` and every other service is the published DSH implementation. The
 * test drives real turns, one real `agent.inject()` receipt and one cancelled
 * pending send, then reads the log back through `ctx.sessionQuery.observeSession`
 * to check that catalogue/resolve cite exactly the accepted native identities.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { EvidenceMessageRow, EvidenceObjectQuery } from '../../packages/host/src/evidence-query.ts';
import { observeEvidence } from '../../packages/host/src/evidence-query.ts';
import { EvidenceQuery, type EvidenceCatalogueInput } from '../../packages/domain/src/evidence/evidence-query.ts';
import { EvidenceRefSchema } from '../../packages/contracts/src/index.ts';
import { mountNativeAgentHarness, type NativeAgentHarness } from '../fixtures/native-agent.ts';

const harnesses: NativeAgentHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0).reverse()) await harness.dispose();
});

async function tracked<T extends NativeAgentHarness>(harness: T): Promise<T> {
  harnesses.push(harness);
  return harness;
}

/** Independent read of the raw native log: identity, event time and author kind. */
async function nativeAccepted(harness: NativeAgentHarness, sessionId: string) {
  const observation = await harness.ctx.sessionQuery.observeSession(SessionId(sessionId));
  try {
    return observation.events.filter((event): event is SessionEvent<'user/message'> => event.type === 'user/message')
      .map(event => ({
        messageId: String(event.data.id), occurredAt: new Date(event.time).toISOString(),
        kind: String(event.data.source.kind),
        text: event.data.content.map(block => (block.type === 'text' ? block.text : '')).join(''),
      }));
  } finally { observation[Symbol.dispose](); }
}

/** Compile-time binding of the Host projection rows to the domain catalogue input. */
function asCatalogueInput(sessionId: string, rows: readonly EvidenceMessageRow[]): EvidenceCatalogueInput {
  return { sessionId, messages: rows };
}

describe('native accepted input becomes the basis catalogue', () => {
  test('student words, an injected receipt and assistant replies stay distinguishable', async () => {
    const harness = await tracked(await mountNativeAgentHarness({ subagents: true }));
    harness.adapter.script(null, { kind: 'text', text: '好，我们从定义域这一步开始。' });
    const agent = await harness.createAgent('evidence-split');
    await harness.turn(agent, '我一般先把定义域写出来');
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: '【单据·结果】卡片已经收好' }],
      source: { kind: 'plugin', plugin: 'studyforge' },
    }));
    await harness.turn(agent, '那这道题也这样吗');

    const accepted = await nativeAccepted(harness, 'evidence-split');
    const rows = await observeEvidence(harness.ctx, 'evidence-split');
    const catalogue = new EvidenceQuery().catalogue(asCatalogueInput(rows.sessionId, rows.messages));

    expect(catalogue.entries.map(entry => entry.quote)).toEqual(['我一般先把定义域写出来', '那这道题也这样吗']);
    expect(catalogue.skipped.system).toBe(1);
    expect(catalogue.skipped.assistant).toBe(2);
    expect(catalogue.skipped.other).toBe(0);

    // Each alias carries the real accepted native identity and event time.
    for (const entry of catalogue.entries) {
      const native = accepted.find(item => item.messageId === entry.messageId);
      expect(native?.kind).toBe('user');
      expect(native?.occurredAt).toBe(entry.occurredAt);
    }
    // The receipt is real accepted history, but never becomes the student's words.
    const receipt = accepted.find(item => item.kind === 'plugin');
    expect(receipt?.text).toContain('【单据·结果】');
    expect(catalogue.entries.some(entry => entry.messageId === receipt?.messageId)).toBe(false);
  });

  test('a cancelled pending send never reached the log and has no alias', async () => {
    const harness = await tracked(await mountNativeAgentHarness({ subagents: true }));
    harness.adapter.script('evidence-cancel', { kind: 'wait-for-abort' });
    const agent = await harness.createAgent('evidence-cancel');
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '第一句进入日志' }], source: { kind: 'user' } }));
    await expect.poll(() => harness.adapter.forSession('evidence-cancel').length).toBe(1);
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '排队之后被取消' }], source: { kind: 'user' } }));
    agent.cancel({ kind: 'user' });
    await agent.whenIdle();

    const accepted = await nativeAccepted(harness, 'evidence-cancel');
    const catalogue = new EvidenceQuery().catalogue(await observeEvidence(harness.ctx, 'evidence-cancel'));
    expect(accepted.map(item => item.text)).toEqual(['第一句进入日志']);
    expect(catalogue.entries.map(entry => entry.quote)).toEqual(['第一句进入日志']);
  });

  test('repeated queries add nothing, and adopted refs survive a restart-shaped round-trip', async () => {
    const harness = await tracked(await mountNativeAgentHarness({ subagents: true }));
    harness.adapter.script(null, { kind: 'text', text: '记下了。' });
    const agent = await harness.createAgent('evidence-stable');
    await harness.turn(agent, '这道题我先配方，因为二次项要配成完全平方');
    harness.adapter.script(null, { kind: 'text', text: '继续。' });
    await harness.turn(agent, '后面这一步我没想到');

    const query = new EvidenceQuery();
    const first = query.catalogue(await observeEvidence(harness.ctx, 'evidence-stable'));
    const before = (await nativeAccepted(harness, 'evidence-stable')).length;
    const second = query.catalogue(await observeEvidence(harness.ctx, 'evidence-stable'));
    expect(second).toEqual(first);
    expect((await nativeAccepted(harness, 'evidence-stable')).length).toBe(before);

    const basis = query.resolve(first, ['E1', 'E2']);
    expect(basis.map(ref => ref.messageId)).toEqual(first.entries.map(entry => entry.messageId));
    expect(basis.map(ref => ref.source)).toEqual(['student_statement', 'student_statement']);
    // What P5/P7 would persist re-validates on its own and still names the same native message.
    const persisted = JSON.parse(JSON.stringify(basis)) as unknown[];
    expect(persisted.map(ref => EvidenceRefSchema.parse(ref))).toEqual(basis);
    const reopened = query.catalogue(await observeEvidence(harness.ctx, 'evidence-stable'));
    expect(reopened.entries[0]?.messageId).toBe(basis[0]?.messageId);
    expect(reopened.entries[0]?.occurredAt).toBe(basis[0]?.occurredAt);
  });

  test('objects come only from the explicit resolver and keep their real version', async () => {
    const harness = await tracked(await mountNativeAgentHarness({ subagents: true }));
    harness.adapter.script(null, { kind: 'text', text: '好。' });
    const agent = await harness.createAgent('evidence-objects');
    await harness.turn(agent, '这两问我都按配方做了');

    const accepted = await nativeAccepted(harness, 'evidence-objects');
    const messageId = accepted[0]!.messageId;
    const query = new EvidenceQuery();

    // No resolver: nothing is fabricated, the basis stays a bare statement.
    const bare = query.catalogue(await observeEvidence(harness.ctx, 'evidence-objects'));
    expect(bare.entries[0]?.objects).toEqual([]);
    expect(query.resolve(bare, ['E1'])[0]).not.toHaveProperty('object');

    // A dependency that really resolved this message brings its object version.
    const withObjects = query.catalogue(await observeEvidence(harness.ctx, 'evidence-objects', {
      resolveObjects: (cited: EvidenceObjectQuery) => (cited.messageId === messageId
        ? [{ ref: 'card:c1', version: 4 }, { ref: 'card:c2', version: 1 }]
        : []),
    }));
    const basis = query.resolve(withObjects, ['E1']);
    expect(basis.map(ref => [ref.object?.ref, ref.object?.version])).toEqual([['card:c1', 4], ['card:c2', 1]]);
    expect(basis.every(ref => ref.source === 'classroom_evidence')).toBe(true);
  });
});

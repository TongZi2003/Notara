/**
 * P7.4 helper boundaries against the real native subagent runtime.
 *
 * Every delegation here is a published child of the real `ctx.subagents` spawn
 * provider; the fake is the model adapter only. So the assertions read what the
 * provider really sent — the child's own persona, its own message list and the
 * tool names it was actually allowed to see — instead of trusting a persona
 * string to have isolated anything.
 *
 * Where the product storage matters the seams are real too: a real
 * `openWorkspaceRecords` workspace, the real `CardService`, a real imported
 * markdown material and real `ExecutionAccess` binding records. The one
 * stand-in is the native session observation the access binding normally
 * derives from (the harness creates agents directly, without a preset), which
 * is stated at the point where it is substituted.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { SessionId } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import type { HostContext } from '../../packages/contracts/src/execution.ts';
import { MaterialRecordSchema, type MaterialMediaType } from '../../packages/contracts/src/material-records.ts';
import type { SourceAnchor } from '../../packages/contracts/src/materials.ts';
import { SkeletonRecordSchema } from '../../packages/contracts/src/skeleton.ts';
import { ExecutionAccess, ExecutionBindingSchema } from '../../packages/domain/src/access/execution-binding.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { CardService } from '../../packages/domain/src/cards/card-service.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { SKELETON_KIND, SkeletonService } from '../../packages/domain/src/materials/skeleton-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import type { RecordStore } from '../../packages/domain/src/storage/record-store.ts';
import {
  DELEGATION_TOOLS, AssistantDelegationInputSchema, PeerDelegationInputSchema, ProblemDelegationInputSchema,
  assistantTask, loadAssistantBriefs, peerTask, registerDelegationTools, type TeachingDelegation,
} from '../../packages/host/src/teaching/native-delegation.ts';
import {
  cleanupTempRoot, mountNativeAgentHarness, requestText, tempRoot, type CapturedRequest, type NativeAgentHarness,
} from '../fixtures/native-agent.ts';

const ASSISTANTS_DIR = fileURLToPath(new URL('../../resources/teaching/assistants/', import.meta.url));
const WORKSPACE = 'student-a';
const clock = createTestClock('2026-09-12T00:00:00.000Z', 'Asia/Shanghai');
const LESSON: HostContext = { workspaceId: WORKSPACE, sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
const encoded = (text: string) => new TextEncoder().encode(text);
const STORY = '# 三角恒等变换\n\n平方关系\n商数关系\n';

/** Stub tools standing in for the preset surface a lesson really composes. */
const ALLOWED_STUBS = ['list_materials', 'read_material', 'preview_region', 'read_skeleton', 'read_method', 'search_learning', 'web_search', 'web_fetch', 'list_sets', 'read_set', 'send_message'] as const;
/** Tools no helper may keep: student state, E, writers, arbitrary fs, another lesson's tools. */
const FORBIDDEN_STUBS = ['list_cards', 'read_cards', 'query_evidence', 'read_memory', 'record_review', 'propose_review', 'update_card', 'register_cards', 'propose_card', 'note_method', 'revise_method', 'write', 'edit', 'read', 'glob', 'grep', 'read_image', 'bash', 'subagent', 'propose_route'] as const;

const harnesses: NativeAgentHarness[] = [];
const cleanups: (() => Promise<void>)[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const harness of harnesses.splice(0).reverse()) await harness.dispose();
  for (const root of roots.splice(0).reverse()) await cleanupTempRoot(root);
});

function stubTool(host: Context, name: string): void {
  host.tools.register(defineTool({
    name, description: `测试接线工具 ${name}`,
    parameters: { text: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: String(value) }] },
    async execute() { return name; },
  }));
}

/** The Host registers its services on the live Context; this is the same call. */
function provide(ctx: Context, name: string, value: unknown): void {
  void (ctx.reflect as unknown as { provide(name: string, value: unknown): () => void }).provide(name, value);
}

type CardStore = RecordStore<typeof CardRecordSchema>;

interface Mounted {
  readonly harness: NativeAgentHarness;
  readonly delegation: TeachingDelegation;
  readonly cards: CardService;
  readonly cardStore: CardStore;
  readonly materials: MaterialService;
}

/**
 * Mount the real native services plus the real workspace records and access
 * binding. The only substitution is the observation the binding derives from:
 * the harness creates agents directly, so the preset and cwd a real session
 * header would carry are supplied here.
 */
async function mount(): Promise<Mounted> {
  const harness = await mountNativeAgentHarness({ subagents: true });
  harnesses.push(harness);
  const root = await tempRoot('sf-delegation-');
  roots.push(root);
  await harness.ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(harness.ctx, root, WORKSPACE, clock);
  const cardStore = await owner.collection('card', CardRecordSchema);
  const materials = new MaterialService(await owner.collection('material', MaterialRecordSchema), root, clock);
  const skeletons = new SkeletonService(await owner.collection(SKELETON_KIND, SkeletonRecordSchema), materials);
  const cards = new CardService(cardStore, materials, skeletons, undefined);
  const bindings = await owner.collection('binding', ExecutionBindingSchema);
  const access = new ExecutionAccess(root, WORKSPACE, bindings, async id => ({ sessionId: id, cwd: root, preset: 'studyforge-learning' }));
  provide(harness.ctx, 'studyforgeRecords', owner);
  provide(harness.ctx, 'studyforgeMaterialService', materials);
  provide(harness.ctx, 'studyforgeCardRecords', cardStore);
  provide(harness.ctx, 'studyforgeCardService', cards);
  provide(harness.ctx, 'studyforgeAccess', access);
  for (const name of [...ALLOWED_STUBS, ...FORBIDDEN_STUBS]) stubTool(harness.ctx, name);
  const delegation = registerDelegationTools(harness.ctx, { assistantsDir: ASSISTANTS_DIR });
  cleanups.push(async () => { await owner.close(); });
  return { harness, delegation, cards, cardStore, materials };
}

/** The durable mode one listed child really has, if the listing found it. */
function childMode(entries: readonly SubagentListEntry[], childId: string): string | undefined {
  const entry = entries.find(row => row.kind === 'child' && String(row.id) === childId);
  return entry?.kind === 'child' ? entry.mode : undefined;
}

function childRequest(harness: NativeAgentHarness, childId: string): CapturedRequest {
  const request = harness.adapter.captured().find(row => row.sessionId === childId);
  if (!request) throw new Error('no child request was captured');
  return request;
}

test('a helper child is a real native subagent: no lesson conversation, no lesson prompt, only its role tools', async () => {
  const { harness, delegation } = await mount();
  const parent = await harness.createAgent('lesson-delegation');
  // An agent-scoped lesson rule must stay in the lesson, exactly like the
  // conversation itself: the child composes its own scope.
  parent.ctx.systemPrompt.section({ name: 'studyforge:lesson-rule', order: 20100, text: '本课规则：先问下一步，不直接给答案。' });
  await harness.turn(parent, '我们先把平方关系讲清楚');
  harness.adapter.script(null, { kind: 'text', text: '材料里的做法成立：平方关系直接适用。' });

  const task = assistantTask({ materials: [{ title: '三角恒等变换', text: '平方关系：sin^2+cos^2=1' }], standard: '化简时优先用平方关系' });
  const result = await delegation.run({ role: 'assistant', parent, task, signal: new AbortController().signal });
  expect(result).toMatchObject({ role: 'assistant', output: '材料里的做法成立：平方关系直接适用。', stopReason: 'completed', background: false });
  expect(result.childId).not.toBe(parent.session.id);

  const request = childRequest(harness, result.childId);
  // Real identity: a durable direct child of this lesson.
  const observation = await harness.ctx.sessionQuery.observeSession(SessionId(result.childId));
  try { expect(observation.header.parentSession).toBe(parent.session.id); }
  finally { observation[Symbol.dispose](); }
  const children = await harness.ctx.subagents.listChildren(parent.session.id);
  expect(children.map(entry => String(entry.id))).toContain(result.childId);
  expect(childMode(children, result.childId)).toBe('one-shot');

  // Its own persona, its own task, and nothing of the lesson.
  expect(request.system).toContain('你是独立上下文里的助教');
  expect(request.system).not.toContain('本课规则');
  expect(requestText(request)).toContain('化简时优先用平方关系');
  expect(requestText(request)).not.toContain('我们先把平方关系讲清楚');
  const expected = ['list_materials', 'preview_region', 'read_material', 'read_skeleton'];
  expect([...request.toolNames].sort()).toEqual(expected);
  for (const name of FORBIDDEN_STUBS) expect(request.toolNames).not.toContain(name);
  // The parent's own delegation tools are registered for real here, and the
  // child still does not inherit them: a helper cannot delegate further.
  expect(harness.ctx.tools.get(DELEGATION_TOOLS.problem)?.name).toBe(DELEGATION_TOOLS.problem);
  expect(harness.ctx.tools.get(DELEGATION_TOOLS.search)?.name).toBe(DELEGATION_TOOLS.search);
  expect(request.toolNames).not.toContain(DELEGATION_TOOLS.problem);
  expect(request.toolNames).not.toContain(DELEGATION_TOOLS.search);
  expect(request.toolNames).not.toContain('send_message');
  expect([...result.surface].sort()).toEqual(expected);
}, 30_000);

test('a tutor needs a real standard, and the peer contract has no field an answer could travel in', async () => {
  const { harness, delegation } = await mount();
  const parent = await harness.createAgent('lesson-contract');
  // Without an existing standard there is nothing for a tutor to judge by.
  expect(AssistantDelegationInputSchema.safeParse({ materials: [{ title: '书', text: '原文' }] }).success).toBe(false);
  // A reference answer is unrepresentable on the peer role, not merely discouraged.
  expect(PeerDelegationInputSchema.safeParse({ materials: [{ title: '书', text: '原文' }], explanation: '我的解释', standard: '参考解' }).success).toBe(false);
  expect(Object.keys(PeerDelegationInputSchema.shape)).not.toContain('standard');
  expect(Object.keys(PeerDelegationInputSchema.shape)).not.toContain('solution');

  await harness.turn(parent, '我先讲讲这道题，你听着');
  harness.adapter.script(null, { kind: 'text', text: '第二步跳了：你没有说明为什么可以两边同除。' });
  const task = peerTask({ materials: [{ title: '三角恒等变换', text: '平方关系' }], explanation: '两边同除 cos 就得到 tan' });
  const result = await delegation.run({ role: 'peer', parent, task, signal: new AbortController().signal });
  const request = childRequest(harness, result.childId);
  expect(request.system).toContain('你是独立上下文里的同伴评审者');
  const text = requestText(request);
  expect(text).toContain('两边同除 cos 就得到 tan');
  expect(text).not.toContain('我先讲讲这道题');
  expect(text).not.toContain('参考解');
  expect([...request.toolNames].sort()).toEqual(['list_materials', 'read_material']);
}, 30_000);

test('a structured problem set becomes real unlearned cards, and the solution never reaches the lesson model', async () => {
  const { harness, cardStore, materials } = await mount();
  const book = await materials.import({ ...LESSON, purpose: 'creation', operationId: 'book' }, {
    title: '三角恒等变换', fileName: '三角恒等变换.md', mediaType: 'text/markdown' as MaterialMediaType, bytes: encoded(STORY),
  });
  const anchor: SourceAnchor = {
    materialId: book.materialId, versionId: book.currentVersion.versionId,
    locator: { kind: 'text', start: { line: 3, column: 0 }, end: { line: 3, column: 4 } }, quote: '平方关系',
  };
  const parent = await harness.createAgent('lesson-problem');
  // The lesson model asks for problems; the child answers through the native
  // structured-output tool the provider registered in the child's own scope.
  harness.adapter.script('lesson-problem', {
    kind: 'tool-call', name: DELEGATION_TOOLS.problem,
    arguments: JSON.stringify({ target: '平方关系的直接应用', count: 2, sources: [anchor] }),
  });
  harness.adapter.script('lesson-problem', { kind: 'text', text: '题已经准备好，先做第一道。' });
  harness.adapter.script(null, {
    kind: 'tool-call', name: 'structured_output',
    arguments: JSON.stringify({ problems: [
      { title: '平方关系一', front: '已知 $\\sin^2 x+\\cos^2 x=?$', solution: '等于 1，这是平方关系本身。', tags: ['三角'] },
      { title: '平方关系二', front: '已知 $\\sin x=\\frac{1}{2}$，求 $\\cos^2 x$。', solution: '由平方关系：$\\cos^2 x=1-\\frac{1}{4}=\\frac{3}{4}$。' },
    ] }),
  });

  await harness.turn(parent, '给我出两道平方关系的题');
  const stored = cardStore.list(LESSON);
  expect(stored).toHaveLength(2);
  const [first, second] = stored;
  expect(first?.data.content.presentation).toBe('problem');
  expect(first?.data.content.front).toContain('\\sin^2 x');
  expect(first?.data.content.sections).toEqual([{ heading: '解答', body: '等于 1，这是平方关系本身。' }]);
  expect(first?.data.content.sources).toEqual([anchor]);
  expect(first?.data.content.tags).toEqual(['三角']);
  expect(first?.data.history).toEqual([]);
  expect(first?.data.review).toBeUndefined();
  expect(second?.data.content.sections[0]?.body).toContain('\\frac{3}{4}');
  // The card identity comes from the accepted operation, not from a title.
  expect(first?.ref).toMatch(/^card:card_[0-9a-f]{24}$/);

  // The lesson model received the faces only; the solutions stayed behind them.
  const observation = await harness.ctx.sessionQuery.observeSession(parent.session.id);
  try {
    const results = observation.events.filter(event => event.type === 'tool/result')
      .flatMap(event => event.data.message.content[0].content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n');
    expect(results).toContain('平方关系一');
    expect(results).not.toContain('这是平方关系本身');
    expect(results).not.toContain('\\frac{3}{4}');
  } finally { observation[Symbol.dispose](); }

  // The child really was the structured one (outputSchema mounts this tool).
  const child = harness.adapter.captured().find(row => row.sessionId !== 'lesson-problem');
  expect(child?.system).toContain('你是主课堂派出的命题帮手');
  expect([...child?.toolNames ?? []].sort()).toEqual(['list_materials', 'preview_region', 'read_material', 'read_method', 'read_skeleton', 'search_learning', 'structured_output']);
}, 30_000);

test('one accepted problem operation is one effect, an unstructured child registers nothing, and a cancelled run is refused', async () => {
  const { harness, delegation, cardStore } = await mount();
  const parent = await harness.createAgent('lesson-effect');
  harness.adapter.script(null, {
    kind: 'tool-call', name: 'structured_output',
    arguments: JSON.stringify({ problems: [{ title: '一轮一题', front: '求 $1+1$。', solution: '2' }] }),
  });
  const context = { ...LESSON, actor: 'teacher' as const, operationId: 'propose:lesson-effect' };
  const first = await delegation.proposeProblems({ parent, signal: new AbortController().signal, context, target: '基础运算', count: 1 });
  const second = await delegation.proposeProblems({ parent, signal: new AbortController().signal, context, target: '基础运算', count: 1 });
  expect(second.cards).toEqual(first.cards);
  expect(cardStore.list(LESSON)).toHaveLength(1);
  expect(first.cards[0]?.front).toBe('求 $1+1$。');
  expect(first.cards[0]).not.toHaveProperty('solution');

  // A child that only wrote prose never becomes a card.
  harness.adapter.script(null, { kind: 'text', text: '我直接写：答案是 2。' });
  const unstructured = await delegation.proposeProblems({
    parent, signal: new AbortController().signal, context: { ...context, operationId: 'propose:unstructured' }, target: '基础运算', count: 1,
  }).catch((error: unknown) => error);
  // A structured child that never answered through its schema failed its own
  // turn; either way nothing is accepted as a product.
  expect(unstructured).toMatchObject({ code: 'delegation_incomplete' });
  expect(cardStore.list(LESSON)).toHaveLength(1);

  // Cancelling the caller's signal is honoured, and the run is not reported as a result.
  harness.adapter.script(null, { kind: 'wait-for-abort' });
  const controller = new AbortController();
  const pending = delegation.run({ role: 'search', parent, task: '查一下平方关系的变形', signal: controller.signal });
  await expect.poll(() => harness.adapter.captured().some(row => row.sessionId !== 'lesson-effect')).toBe(true);
  controller.abort('学生取消');
  await expect(pending).rejects.toBeDefined();
}, 30_000);

test('a background search keeps a durable child that reports back through the native channel', async () => {
  const { harness, delegation } = await mount();
  const parent = await harness.createAgent('lesson-background');
  harness.adapter.script(null, { kind: 'wait-for-abort' });
  const result = await delegation.run({
    role: 'search', parent, task: '查一下平方关系的常见变形', signal: new AbortController().signal, background: true,
  });
  expect(result).toMatchObject({ role: 'search', background: true, stopReason: 'accepted', output: '' });
  expect(result.surface).toContain('send_message');
  await expect.poll(() => harness.adapter.forSession(result.childId).length).toBe(1);

  const children = await harness.ctx.subagents.listChildren(parent.session.id);
  expect(childMode(children, result.childId)).toBe('continuable');
  harness.ctx.subagents.interrupt(SessionId(result.childId), { kind: 'ancestor', agent: parent });
  await harness.ctx.subagents.drainContinuableChildren(parent, [SessionId(result.childId)]);
  const request = childRequest(harness, result.childId);
  expect(request.system).toContain('你是主课堂临时派出的检索帮手');
  expect(requestText(request)).toContain('查一下平方关系的常见变形');
  for (const name of ['query_evidence', 'update_card', 'write', 'delegate_search']) expect(request.toolNames).not.toContain(name);
}, 30_000);

test('the role briefs are real files, and a missing or templated one fails registration loudly', async () => {
  const briefs = loadAssistantBriefs(ASSISTANTS_DIR);
  expect(briefs.persona.assistant).toContain('助教');
  expect(briefs.persona.peer).toContain('参考答案');
  expect(() => loadAssistantBriefs(join(ASSISTANTS_DIR, 'missing'))).toThrowError(/assistant_brief_missing/);
  const { harness } = await mount();
  expect(Object.keys(ProblemDelegationInputSchema.shape)).toEqual(['target', 'constraints', 'count', 'sources']);
  expect(harness.ctx.tools.get(DELEGATION_TOOLS.problem)?.name).toBe(DELEGATION_TOOLS.problem);
});

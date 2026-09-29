import { afterAll, beforeAll, expect, test } from 'vitest';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault, effectiveSystemText, type VaultHarness } from '../fixtures/vault-http.ts';
// @ts-expect-error untyped plugin module: exercise its real parser and fingerprint.
import { boardComponents } from '../../examples/native-vault/board-components.js';

interface BoardBlock { id: string; title: string; section?: string; body: string; x?: number; y?: number; answers?: { id: string; c: number; fp: string; v: Record<string, unknown> }[] }
interface BoardValue { revision: string; sections: { id: string; title: string }[]; blocks: BoardBlock[] }
interface Answered extends BoardValue { delivery: { answerId: string; sent: boolean; queued: boolean } }

const question = (options: string[]) => '```choice\n这条弦的斜率是正还是负？\n' + options.map(option => `- ${option}`).join('\n') + '\n```';
let runtime: VaultRuntime, harness: VaultHarness;
beforeAll(async () => { runtime = await startVaultIsolated({ testModel: true }); harness = await connectVault(runtime); harness.approvals.auto('allowed-once'); }, 180_000);
afterAll(async () => { await harness?.close(); await runtime?.stop(); });

const board = async (sessionId: string) => harness.value(await harness.rpc<BoardValue>('notaraVault/board', { input: { sessionId } }));

test('a board answer is stored, then arrives as the student’s own message; a changed question keeps it apart', async () => {
  const session = await harness.createSession();
  await harness.ask(session, '出一道判断题', { '出一道判断题': { calls: [{ name: 'write_lesson_board', arguments: { title: '先判断', section: '第1题 中点弦的斜率', body: `先判断方向。\n\n${question(['正', '负'])}` } }], text: '白板上有一道小题。' } });
  const written = await board(session);
  expect(written.sections).toEqual([{ id: expect.stringMatching(/^s-[a-f0-9]{8}$/), title: '第1题 中点弦的斜率' }]);
  const target = written.blocks[0]!;
  expect(target).toMatchObject({ title: '先判断', section: written.sections[0]!.id });
  expect(target.x).toBeUndefined();
  const [component] = boardComponents(target.body);

  // A malformed question is refused with its position and the syntax.
  await harness.ask(session, '写一道坏题', { '写一道坏题': { calls: [{ name: 'write_lesson_board', arguments: { title: '坏题', body: '```choice\n- 甲\n- 乙\n```' } }], text: '好。' } });
  const refused = (await harness.outcomes(session)).at(-1);
  expect(refused?.failed).toBe(true);
  expect(refused?.text).toMatch(/board_component_invalid：第1个组件（choice）缺少题干[\s\S]*choice 的写法/);

  const message = '〔白板｜第1题 中点弦的斜率｜这条弦的斜率是正还是负？〕我选：B 负。理由：中点在第一象限';
  await harness.scriptOne(message, '你的依据是什么？');
  const before = (await harness.turns(session)).length;
  const answered = harness.value(await harness.rpc<Answered>('notaraVault/answerBoard', { input: { sessionId: session, blockId: target.id, component: 0, fingerprint: component.fingerprint, value: { pick: [1], reason: '中点在第一象限' } } }));
  expect(answered.delivery).toMatchObject({ sent: true });
  expect(answered.blocks[0]!.answers).toEqual([expect.objectContaining({ c: 0, fp: component.fingerprint, v: { pick: [1], reason: '中点在第一象限' } })]);
  await harness.waitForTurn(session, before);
  const turn = (await harness.turns(session)).at(-1)!;
  const student = turn.messages.findLast(item => item.role === 'user' && item.source?.kind === 'user');
  expect(student?.content.map(block => block.text).join('')).toBe(message);
  // The teacher's per-turn board view shows the answer state, not the answer key.
  expect(effectiveSystemText(turn) + JSON.stringify(turn.messages)).toMatch(/choice#1（选择与判断）已作答 1 次/);

  // Invalid answers never reach the teacher.
  const invalid = await harness.rpc('notaraVault/answerBoard', { input: { sessionId: session, blockId: target.id, component: 0, fingerprint: component.fingerprint, value: { pick: [0, 1] } } });
  expect(invalid.ok).toBe(false);

  // A student drag does not block the teacher's rewrite; the rewrite keeps the pin and the answers.
  const pinned = harness.value(await harness.rpc<BoardValue>('notaraVault/mutateBoard', { input: { sessionId: session, expectedRevision: answered.revision, blockId: target.id, patch: { x: 700, y: 400 } } }));
  expect(pinned.blocks[0]).toMatchObject({ x: 700, y: 400 });
  await harness.ask(session, '改一下题', { '改一下题': { calls: [{ name: 'write_lesson_board', arguments: { title: '先判断', body: `先判断方向。\n\n${question(['正', '负', '不能确定符号'])}` } }], text: '题目补了一个选项。' } });
  const rewritten = await board(session);
  expect((await harness.outcomes(session)).at(-1)?.failed).toBe(false);
  expect(rewritten.blocks[0]).toMatchObject({ x: 700, y: 400 });
  expect(rewritten.blocks[0]!.answers).toHaveLength(1);
  const [changed] = boardComponents(rewritten.blocks[0]!.body);
  expect(changed.fingerprint).not.toBe(component.fingerprint);
  const stale = await harness.rpc('notaraVault/answerBoard', { input: { sessionId: session, blockId: target.id, component: 0, fingerprint: component.fingerprint, value: { pick: [0] } } });
  expect(stale.ok).toBe(false);
  if (!stale.ok) expect(stale.error.message).toBe('这道题刚被老师改过，请看一眼新题目再作答。');
  await harness.ask(session, '继续', { '继续': '好，我们看新选项。' });
  const nextTurn = (await harness.turns(session)).at(-1)!;
  expect(effectiveSystemText(nextTurn) + JSON.stringify(nextTurn.messages)).toMatch(/未作答；另有 1 次题目修改前的作答/);
}, 240_000);

test('figure and flow answers are checked against the figure and described for the teacher', async () => {
  const session = await harness.createSession();
  const figure = '```figure\naxes x -4..4 y -3..3\nfunction f(x) = (x-1)^2 - 2\nask point "点出顶点"\n```';
  const flow = '```flow\nA[发行过量] --> E[?]\nE --> C[挤兑]\n```';
  await harness.ask(session, '画两张图', { '画两张图': { calls: [
    { name: 'write_lesson_board', arguments: { title: '顶点', section: '第2题', body: figure } },
    { name: 'write_lesson_board', arguments: { title: '因果', body: flow } },
  ], text: '好。' } });
  // The old parabola argument is no longer part of the tool.
  await harness.ask(session, '旧写法', { '旧写法': { calls: [{ name: 'write_lesson_board', arguments: { title: '抛物线', body: 'x', interactive: { provider: 'math', preset: 'parabola', scene: { preset: 'parabola' } } } }], text: '好。' } });
  expect((await harness.outcomes(session)).at(-1)?.failed).toBe(true);
  const value = await board(session);
  const [vertex] = boardComponents(value.blocks.find(block => block.title === '顶点')!.body);
  const [gap] = boardComponents(value.blocks.find(block => block.title === '因果')!.body);
  const answer = (blockTitle: string, component: { fingerprint: string }, input: unknown) => harness.rpc<Answered>('notaraVault/answerBoard', { input: { sessionId: session, blockId: value.blocks.find(block => block.title === blockTitle)!.id, component: 0, fingerprint: component.fingerprint, value: input } });
  expect((await answer('顶点', vertex, { point: { x: 90, y: 0 } })).ok).toBe(false);
  const expected = '〔白板｜第2题｜点出顶点〕我在图上点了 (1.02, -1.98)';
  await harness.scriptOne(expected, '对，为什么是这里？');
  let before = (await harness.turns(session)).length;
  expect(harness.value(await answer('顶点', vertex, { point: { x: 1.0213, y: -1.9812 } })).delivery.sent).toBe(true);
  await harness.waitForTurn(session, before);
  expect((await harness.turns(session)).at(-1)!.messages.findLast(item => item.role === 'user' && item.source?.kind === 'user')?.content.map(block => block.text).join('')).toBe(expected);
  before = (await harness.turns(session)).length;
  expect(harness.value(await answer('因果', gap, { fills: { E: '币值下跌' } })).delivery.sent).toBe(true);
  await harness.waitForTurn(session, before);
  expect((await harness.turns(session)).at(-1)!.messages.findLast(item => item.role === 'user' && item.source?.kind === 'user')?.content.map(block => block.text).join('')).toBe('〔白板｜第2题｜关系图〕（接在“发行过量”之后）我填：币值下跌');
}, 240_000);

test('a frame prediction arrives as the student’s message; 直接看 is recorded without a message', async () => {
  const session = await harness.createSession();
  const frames = '```frames\ntitle 竖直上抛\nframe 抛出瞬间\n速度向上\npredict\nframe 最高点\n速度为 0\npredict\nframe 落回\n速度向下\n```';
  await harness.ask(session, '看上抛', { '看上抛': { calls: [{ name: 'write_lesson_board', arguments: { title: '上抛', section: '第5题', body: frames } }], text: '好。' } });
  const value = await board(session), block = value.blocks[0]!, [component] = boardComponents(block.body);
  const answer = (input: unknown) => harness.rpc<Answered>('notaraVault/answerBoard', { input: { sessionId: session, blockId: block.id, component: 0, fingerprint: component.fingerprint, value: input } });
  expect((await answer({ frame: 0, text: '第一帧不能预测' })).ok).toBe(false);
  const message = '〔白板｜第5题｜竖直上抛〕我预测第2帧（最高点）：速度是 0';
  await harness.scriptOne(message, '加速度呢？');
  let before = (await harness.turns(session)).length;
  expect(harness.value(await answer({ frame: 1, text: '速度是 0' })).delivery.sent).toBe(true);
  await harness.waitForTurn(session, before);
  expect((await harness.turns(session)).at(-1)!.messages.findLast(item => item.role === 'user' && item.source?.kind === 'user')?.content.map(part => part.text).join('')).toBe(message);
  before = (await harness.turns(session)).length;
  const skipped = harness.value(await answer({ frame: 2, skipped: true }));
  expect(skipped.delivery).toMatchObject({ sent: false, silent: true });
  expect(skipped.blocks[0]!.answers?.at(-1)?.v).toEqual({ frame: 2, skipped: true });
  await new Promise(resolve => setTimeout(resolve, 1500));
  expect((await harness.turns(session)).length, '直接看 starts no teacher turn').toBe(before);
  await harness.ask(session, '继续讲', { '继续讲': '好。' });
  const overview = effectiveSystemText((await harness.turns(session)).at(-1)!) + JSON.stringify((await harness.turns(session)).at(-1)!.messages);
  expect(overview).toMatch(/frames#1（逐帧演示）已作答 2 次，最近 \d\d:\d\d：第3帧（落回）没有预测，直接看了。/);
}, 240_000);

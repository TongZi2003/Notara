import { beforeAll, afterAll, expect, test } from 'vitest';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault, effectiveSystemText, type VaultHarness } from '../fixtures/vault-http.ts';
// @ts-expect-error untyped plugin: exercise the real persisted board path and components.
import { boardPath } from '../../examples/native-vault/board-runtime.js';
// @ts-expect-error untyped plugin: the question fingerprint is the shared contract.
import { boardComponents } from '../../examples/native-vault/board-components.js';

interface BoardValue { revision: string | null; sections: unknown[]; blocks: Array<{ id: string; title: string; body: string; width?: number; height?: number; x?: number; y?: number; answers?: unknown[] }>; sources: Array<{ path: string; width?: number; height?: number; body?: string }> }
let runtime: VaultRuntime, client: VaultHarness;
const board = async (sessionId: string) => client.value(await client.rpc<BoardValue>('notaraVault/board', { input: { sessionId } }));
const fork = async (sessionId: string, atSeq?: number) => client.value(await client.rpc<{ sessionId: string }>('session/fork', { request: { sessionId, ...(atSeq === undefined ? {} : { atSeq }) } }));
beforeAll(async () => { runtime = await startVaultIsolated({ testModel: true }); client = await connectVault(runtime); client.approvals.auto('rejected'); }, 60_000);
afterAll(async () => { await client?.close(); await runtime?.stop(); }, 30_000);

test('native forks inherit the complete board at click time, keep independent updates and survive cold restart', async () => {
  const parent = await client.createSession();
  await client.writeVaultFile('材料.md', '---\ntype: source\ntitle: 题目材料\n---\n# 原始材料\n遗传题合成资料。\n');
  const body = '公开推导。[[材料.md]]\n\n```frames\ntitle 预测下一步\nframe 已知条件\n条件成立\npredict\nframe 下一步\n分离与组合\n```';
  await client.ask(parent, '写分支白板', { '写分支白板': { calls: [{ name: 'write_lesson_board', arguments: { title: '遗传推导', section: '第一题', body } }], text: '原课堂板书已准备。' } });
  let source = await board(parent);
  source = client.value(await client.rpc<BoardValue>('notaraVault/mutateBoard', { input: { sessionId: parent, expectedRevision: source.revision, blockId: source.blocks[0]!.id, patch: { x: 640, y: 230, width: 420, height: 350 } } }));
  source = client.value(await client.rpc<BoardValue>('notaraVault/mutateBoard', { input: { sessionId: parent, expectedRevision: source.revision, sourcePath: '材料.md', patch: { width: 520, height: 330, body: '学生保留的备注' } } }));
  const component = boardComponents(source.blocks[0]!.body)[0];
  source = client.value(await client.rpc<BoardValue>('notaraVault/answerBoard', { input: { sessionId: parent, blockId: source.blocks[0]!.id, component: 0, fingerprint: component.fingerprint, value: { frame: 1, skipped: true } } }));
  expect(source.blocks[0]!.answers).toHaveLength(1);
  const children = await Promise.all([fork(parent), fork(parent, 0)]);
  for (const child of children) {
    const inherited = await board(child.sessionId);
    expect(inherited.blocks).toEqual(source.blocks);
    expect(inherited.sections).toEqual(source.sections);
    expect(inherited.sources).toEqual(source.sources);
    expect(await client.turns(child.sessionId), 'copying old answers must not prompt the teacher').toHaveLength(0);
  }
  const child = children[0]!.sessionId;
  await client.ask(child, '继续新分支', { '继续新分支': { calls: [{ name: 'write_lesson_board', arguments: { title: '遗传推导', body: '新分支继续验证另一个假设。' } }], text: '继续使用继承的白板。' } });
  const assembled = (await client.turns(child))[0]!;
  expect(effectiveSystemText(assembled) + JSON.stringify(assembled.messages)).toContain('遗传推导');
  expect((await client.outcomes(child)).at(-1)?.failed).toBe(false);
  const changed = await board(child);
  expect(changed.blocks[0]!.body).toBe('新分支继续验证另一个假设。');
  expect(changed.blocks[0]).toMatchObject({ x: 640, y: 230, width: 420, height: 350 });
  expect((await board(parent)).blocks).toEqual(source.blocks);
  expect((await board(children[1]!.sessionId)).blocks).toEqual(source.blocks);
  await client.close(); await runtime.restart(); client = await connectVault(runtime);
  expect((await board(parent)).blocks).toEqual(source.blocks);
  expect((await board(child)).blocks).toEqual(changed.blocks);
  expect((await board(child)).sources).toEqual(changed.sources);
  expect((await board(children[1]!.sessionId)).blocks).toEqual(source.blocks);
}, 120_000);

test('an empty classroom fork stays empty without creating a board placeholder', async () => {
  const parent = await client.createSession();
  await client.ask(parent, '空白课堂分支', { '空白课堂分支': '这节课没有写板书。' });
  const child = await fork(parent), value = await board(child.sessionId);
  expect(value.blocks).toEqual([]); expect(value.revision).toBeNull();
  expect(await client.vaultExists(boardPath(child.sessionId))).toBe(false);
}, 60_000);

test('a foreign board binding refuses the fork and leaves no new classroom after restart', async () => {
  const parent = await client.createSession();
  await client.ask(parent, '无效板书课堂', { '无效板书课堂': '准备验证无效绑定。' });
  await client.writeVaultFile(boardPath(parent), '---\ntype: lesson-board\ntitle: 课堂板书\nsession: another-classroom\nsourceNotes: {}\n---\n');
  const before = (await client.sessions()).map(row => row.sessionId).sort();
  const result = await client.rpc('session/fork', { request: { sessionId: parent } });
  expect(result.ok).toBe(false);
  expect((await client.sessions()).map(row => row.sessionId).sort()).toEqual(before);
  await client.close(); await runtime.restart(); client = await connectVault(runtime);
  expect((await client.sessions()).map(row => row.sessionId).sort()).toEqual(before);
}, 60_000);

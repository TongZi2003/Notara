import { expect, test } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { VAULT_SOLVER_PROVIDER, VAULT_SOLVER_MODEL } from '../../scripts/fixtures/vault-test-model.ts';
import { connectVault, type AssembledMessage, type AssembledRequest, type VaultHarness } from '../fixtures/vault-http.ts';
// @ts-expect-error untyped plugin: use its pure serializer without invoking a provider.
import { responsesRequest } from '../../examples/native-vault/chatgpt-provider.js';

interface BoardValue {
  revision: string;
  sections: unknown[];
  blocks: Array<{ id: string; title: string; body: string }>;
}
interface ModelProjection {
  values: { modelSelection: { next: { provider: string; model: string } | null; lastUsed: { provider: string; model: string } | null } };
}

const textOf = (message: AssembledMessage) => message.content.map(block => block.text ?? '').join('');
const systemMessages = (request: AssembledRequest) => request.messages.filter(message => message.role === 'system');
const contexts = (request: AssembledRequest) => request.messages.filter(message => message.source?.kind === 'runtime-context');
const wireInput = async (request: AssembledRequest): Promise<unknown[]> => {
  // Native loop requests already carry their system messages in history.
  // Adding options.system here would duplicate that content in the wire input.
  const wire = await responsesRequest({ provider: request.provider, model: request.model, messages: request.messages, tools: request.toolSchemas });
  return wire.input;
};

async function expectRetainedPrefix(before: AssembledRequest, after: AssembledRequest, restarted?: { beforeOrigin: string; afterOrigin: string }) {
  expect(after.messages.length).toBeGreaterThan(before.messages.length);
  expect(after.messages.slice(0, before.messages.length)).toEqual(before.messages);
  const previousSystem = systemMessages(before), nextSystem = systemMessages(after);
  if (restarted) {
    // A fresh native request series may append a new system snapshot. The
    // isolated restart chooses another GUI port; only that environment value
    // may differ, and none of the previous system history may be rewritten.
    expect(nextSystem.slice(0, previousSystem.length)).toEqual(previousSystem);
    expect(nextSystem).toHaveLength(previousSystem.length + 1);
    const contentAt = (message: AssembledMessage, origin: string) => message.content.map(block => ({ ...block, ...(block.text === undefined ? {} : { text: block.text.split(origin).join('<isolated-gui-origin>') }) }));
    expect(contentAt(nextSystem.at(-1)!, restarted.afterOrigin)).toEqual(contentAt(previousSystem.at(-1)!, restarted.beforeOrigin));
  } else expect(nextSystem).toEqual(previousSystem);
  expect(after.toolSchemas).toEqual(before.toolSchemas);
  // The existing history keeps its selected route, including when the isolated
  // deployment default changes. This does not measure provider cache hits.
  expect([after.provider, after.model]).toEqual([before.provider, before.model]);
  const effortOf = (request: AssembledRequest) => (request as AssembledRequest & { reasoningEffort: string | null }).reasoningEffort;
  expect(effortOf(after)).toBe(effortOf(before));
  const previousInput = await wireInput(before), nextInput = await wireInput(after);
  expect(nextInput.length).toBeGreaterThan(previousInput.length);
  expect(nextInput.slice(0, previousInput.length)).toEqual(previousInput);
}

test('stable replies, board tool steps and forks after a default change and restart retain the request prefix and system history', async () => {
  const runtime = await startVaultIsolated({ testModel: true });
  let client: VaultHarness | undefined;
  try {
    client = await connectVault(runtime);
    client.approvals.auto('allowed-once');
    const parent = await client.createSession();
    const board = async (sessionId: string) => client!.value(await client!.rpc<BoardValue>('notaraVault/board', { input: { sessionId } }));
    const ask = (sessionId: string, prompt: string) => client!.ask(sessionId, prompt, { [prompt]: '合成回执。' });

    const [skill] = await ask(parent, '/notara-board\n读取合成课堂板书技能');
    expect(skill).toBeDefined();
    expect(skill!.messages.map(textOf).join('\n')).toContain('<skill_content name="notara-board">');
    const body = 'SYNTHETIC_BOARD_BODY_ONLY\n' + '合成推导：固定条件，代入等式，逐项验证边界及单位。\n'.repeat(100).trimEnd();
    const seedPrompt = '写入合成长板书';
    const seed = await client.ask(parent, seedPrompt, { [seedPrompt]: { calls: [{ name: 'write_lesson_board', arguments: { title: '合成原板书', body } }], text: '合成板书已保存。' } });
    expect(seed).toHaveLength(2);
    await expectRetainedPrefix(skill!, seed[0]!);
    await expectRetainedPrefix(seed[0]!, seed[1]!);
    expect(contexts(seed[1]!).length).toBeGreaterThan(contexts(seed[0]!).length);
    expect(textOf(contexts(seed[1]!).at(-1)!)).toContain('合成原板书');
    const writeCall = seed[1]!.messages.flatMap(message => message.content).find(block => block.type === 'tool-call' && block.name === 'write_lesson_board');
    expect(JSON.parse(writeCall!.arguments!).body).toBe(body);
    for (const context of contexts(seed[1]!)) expect(textOf(context)).not.toContain('SYNTHETIC_BOARD_BODY_ONLY');

    const [stable1] = await ask(parent, '合成稳定回复一');
    const [stable2] = await ask(parent, '合成稳定回复二');
    await expectRetainedPrefix(seed[1]!, stable1!);
    await expectRetainedPrefix(stable1!, stable2!);
    expect(contexts(stable2!)).toEqual(contexts(seed[1]!));

    // A prose-only UI edit changes persisted data without changing the overview.
    const original = await board(parent);
    const edited = client.value(await client.rpc<BoardValue>('notaraVault/mutateBoard', { input: { sessionId: parent, expectedRevision: original.revision, blockId: original.blocks[0]!.id, patch: { body: body + '\n合成正文修改。' } } }));
    expect(edited.revision).not.toBe(original.revision);
    const [bodyChanged] = await ask(parent, '合成正文修改后继续');
    await expectRetainedPrefix(stable2!, bodyChanged!);
    expect(contexts(bodyChanged!)).toEqual(contexts(stable2!));

    const changePrompt = '新增合成板书标题';
    const changed = await client.ask(parent, changePrompt, { [changePrompt]: { calls: [{ name: 'write_lesson_board', arguments: { title: '合成新增标题', body: '新标题对应的公开合成内容。' } }], text: '合成新标题已保存。' } });
    expect(changed).toHaveLength(2);
    await expectRetainedPrefix(bodyChanged!, changed[0]!);
    await expectRetainedPrefix(changed[0]!, changed[1]!);
    const latestContext = contexts(changed[1]!).at(-1)!;
    expect(latestContext.role).toBe('user');
    expect(changed[1]!.messages.indexOf(latestContext)).toBeGreaterThanOrEqual(changed[0]!.messages.length);
    expect(textOf(latestContext)).toContain('合成新增标题');
    const [afterChange] = await ask(parent, '合成白板变更后继续');
    await expectRetainedPrefix(changed[1]!, afterChange!);
    expect(contexts(afterChange!)).toEqual(contexts(changed[1]!));

    // ask() waits for idle after the final model reply, giving fork a real
    // completed-turn boundary rather than a synthetic/open event prefix.
    const currentBoard = await board(parent);
    const parentProjection = client.value(await client.rpc<ModelProjection>('session/projections', { request: { sessionId: parent } }));
    expect(parentProjection.values.modelSelection.next).toMatchObject({ provider: afterChange!.provider, model: afterChange!.model });
    expect(parentProjection.values.modelSelection.lastUsed).toEqual(parentProjection.values.modelSelection.next);

    const liveChild = client.value(await client.rpc<{ sessionId: string }>('session/fork', { request: { sessionId: parent } })).sessionId;
    const [liveContinued] = await ask(liveChild, '合成同进程分支继续');
    await expectRetainedPrefix(afterChange!, liveContinued!);
    expect((await board(liveChild)).blocks).toEqual(currentBoard.blocks);

    // The synthetic fixture pins its default in a home overlay, so the normal
    // selectModel background save cannot override it. Change only this run's
    // generated deployment config and use the public restart/reconnect seam.
    // This proves default-change + cold recovery, not dynamic UI persistence.
    const patchPath = join(runtime.root, 'home/cordis.patch.yml');
    const patches = JSON.parse(await readFile(patchPath, 'utf8')) as Array<{ id?: string; config?: unknown }>;
    const defaults = patches.filter(patch => patch.id === 'agent-default-model');
    expect(defaults).toHaveLength(1);
    const nextDefault = { provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL, reasoningEffort: 'low' };
    defaults[0]!.config = nextDefault;
    await writeFile(patchPath, JSON.stringify(patches) + '\n');
    const beforeRestartOrigin = client.origin;
    await client.close(); await runtime.restart(); client = await connectVault(runtime);
    client.approvals.auto('allowed-once');
    const catalog = client.value(await client.rpc<{ default: typeof nextDefault }>('session/modelCatalog', {}));
    expect(catalog.default).toEqual(nextDefault);
    expect([catalog.default.provider, catalog.default.model]).not.toEqual([afterChange!.provider, afterChange!.model]);

    const child = client.value(await client.rpc<{ sessionId: string }>('session/fork', { request: { sessionId: parent } })).sessionId;
    const inherited = await board(child);
    expect(inherited.blocks).toEqual(currentBoard.blocks);
    expect(inherited.sections).toEqual(currentBoard.sections);
    expect(await client.turns(child)).toHaveLength(0);
    // A child with no model request of its own already has the seed's durable
    // lastUsed/next selection, as exposed by the native public projection.
    const childProjection = client.value(await client.rpc<ModelProjection>('session/projections', { request: { sessionId: child } }));
    expect(childProjection.values.modelSelection).toEqual(parentProjection.values.modelSelection);
    const [continued] = await ask(child, '合成分支继续');
    await expectRetainedPrefix(afterChange!, continued!, { beforeOrigin: beforeRestartOrigin, afterOrigin: client.origin });
    const childContext = contexts(continued!).at(-1)!;
    expect(continued!.messages.indexOf(childContext)).toBeGreaterThanOrEqual(afterChange!.messages.length);
    expect(textOf(childContext)).toContain('合成新增标题');
    expect(childContext).not.toEqual(latestContext);
    expect((await client.outcomes(parent)).filter(outcome => outcome.name === 'write_lesson_board').map(outcome => outcome.failed)).toEqual([false, false]);
  } finally {
    await client?.close();
    await runtime.stop();
  }
}, 60_000);

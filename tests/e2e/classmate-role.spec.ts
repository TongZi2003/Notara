import { resolve } from 'node:path';
import type { PluginCandidate, PluginView, WorldbookView } from '@studyforge/contracts/plugins';
import { test, expect, enterClassroom } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

function value<T>(reply: { ok: boolean; value?: T; error?: unknown }): T {
  if (!reply.ok || reply.value === undefined) throw new Error(JSON.stringify(reply.error));
  return reply.value;
}

const naruto = {
  id: 'naruto', name: '鸣人', purpose: '在学生自我怀疑时鼓励他继续动笔',
  instructions: '你是漩涡鸣人。用直白、不认输的语气回应学生的泄气话；只鼓励，不教题、不替学生做题。',
  enabled: true, personality: '热血不服输', greeting: '我是鸣人！遇到困难我也不会退缩的！',
  relations: [{ target: 'student', label: '同桌', note: '互相打气的同桌。' }],
};

test('a teacher-proposed classmate renders readably and joins the classroom only after the student confirms', async ({ page, classroom }, info) => {
  const client = await connectRuntime(classroom);
  const candidate = value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare', { input: { kind: 'directory', path: resolve('examples/plugins/worldbook') } }));
  const plugin = value(await client.rpc<PluginView>('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion: 0, trustNative: false } }));
  const session = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {}));
  const id = 'plugin-' + plugin.ref.slice(7) + '-worldbook', target = { ...session, id };
  let world = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
  const roleCount = world.document.classroom?.roles.length ?? 0;
  value(await client.rpc('studyforgePlugins/useWorldbook', { input: { ...target, expectedVersion: world.useRevision, enabled: true } }));
  value(await client.rpc('session/prompt', { request: { sessionId: session.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([
    { name: 'load_tools', arguments: { names: ['read_classroom', 'propose_classmate'] } },
    { name: 'read_classroom', arguments: { id } },
    { name: 'propose_classmate', arguments: { id, role: naruto } },
  ]) }] } }));
  await expect.poll(async () => value(await client.rpc<{ items: { sessionId: string; running: boolean }[] }>('session/list', { _request: {} })).items.find(item => item.sessionId === session.sessionId)?.running, { timeout: 45_000 }).toBe(false);
  value(await client.rpc('session/rename', { request: { sessionId: session.sessionId, title: '泄气时刻' } }));

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await enterClassroom(page, classroom.authUrl);
    await page.getByTestId('notebook-sidebar').getByRole('button', { name: /泄气时刻/ }).click();
    const card = page.getByTestId('proposal-card').last();
    await expect(card).toBeVisible();
    await expect(card.getByTestId('proposal-classmate-name')).toContainText('鸣人');
    await expect(card.getByTestId('proposal-classmate-purpose')).toContainText('鼓励');
    await expect(card.getByTestId('proposal-classmate-greeting')).toContainText('我是鸣人');
    await expect(card.getByTestId('proposal-classmate-relations')).toContainText('同桌');
    await expect(card).toContainText('新同学');
    await page.screenshot({ path: info.outputPath('classmate-proposal.png') });
    await card.getByTestId('proposal-confirm').click();
    await expect(card.getByTestId('proposal-item-status')).toContainText('已经保存');
    world = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
    expect(world.document.classroom?.roles.map(role => role.id)).toContain('naruto');
    expect(world.document.classroom?.roles).toHaveLength(roleCount + 1);
    expect(errors).toEqual([]);
  } catch (error) {
    throw new Error(JSON.stringify({ errors, tail: (await page.locator('body').innerText()).slice(-3000) }), { cause: error });
  }
});

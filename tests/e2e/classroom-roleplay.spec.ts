import { resolve } from 'node:path';
import type { PluginCandidate, PluginView, WorkbenchChoice, WorldbookView } from '@studyforge/contracts/plugins';
import { test, expect, enterClassroom } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

function value<T>(reply: { ok: boolean; value?: T; error?: unknown }): T {
  if (!reply.ok || reply.value === undefined) throw new Error(JSON.stringify(reply.error));
  return reply.value;
}

test('classroom workbench edits scenario, role persona, relations and selective entries through the real save path', async ({ page, classroom }, info) => {
  const client = await connectRuntime(classroom);
  const candidate = value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare', { input: { kind: 'directory', path: resolve('examples/plugins/worldbook') } }));
  const plugin = value(await client.rpc<PluginView>('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion: 0, trustNative: false } }));
  const session = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {}));
  const id = 'plugin-' + plugin.ref.slice(7) + '-worldbook', target = { ...session, id };
  value(await client.rpc('studyforgePlugins/useWorldbook', { input: { ...target, expectedVersion: 0, enabled: true } }));
  value(await client.rpc('session/prompt', { request: { sessionId: session.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '先看看教室。' }] } }));
  value(await client.rpc('session/rename', { request: { sessionId: session.sessionId, title: '扮演设定' } }));

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await enterClassroom(page, classroom.authUrl);
    await page.getByTestId('notebook-sidebar').getByRole('button', { name: /扮演设定/ }).click();
    await page.getByTestId('workspace-open-' + id).click();
    const workbench = page.getByTestId('classroom-workbench');
    await expect(workbench.locator('.nc-scene')).toBeVisible();

    // Classroom-level situational fields.
    await workbench.locator('.nc-scene summary').click();
    await workbench.locator('.nc-scene textarea').fill('开学第一周的晚自习教室。');
    await workbench.locator('.nc-scene input').fill('刚转来的学生。');

    // A new role opens the persona editor directly.
    await workbench.getByRole('button', { name: '邀请新同学' }).click();
    const editor = workbench.locator('.nc-inspector .nc-editor');
    await editor.getByLabel('性格标签').fill('随和，爱举生活例子。');
    await editor.getByLabel('发言倾向').fill('70');
    await editor.getByLabel('开场白').fill('这道题卡哪儿了？');
    await editor.getByRole('button', { name: '添加关系' }).click();
    const relation = editor.locator('.nc-relation').first();
    await relation.locator('select').selectOption('student');
    await relation.locator('input[aria-label="关系称呼"]').fill('同桌');
    await relation.locator('input[aria-label="亲密度"]').fill('55');
    await relation.locator('textarea[aria-label="关系细节"]').fill('开学起坐在一起。');
    await page.screenshot({ path: info.outputPath('roleplay-role.png') });

    // A selective entry bound to that role with an intimacy gate.
    await workbench.getByRole('button', { name: '世界书', exact: true }).click();
    await workbench.getByRole('button', { name: '新增世界书条目' }).click();
    const entryEditor = workbench.locator('.nc-editor').last();
    await entryEditor.getByLabel('标题').fill('熟络玩笑');
    await entryEditor.getByRole('textbox', { name: '内容', exact: true }).fill('同桌熟络之后才聊的梗。');
    const always = entryEditor.getByLabel('始终带入');
    if (await always.isChecked()) await always.uncheck();
    await entryEditor.getByRole('textbox', { name: '关键词', exact: true }).fill('闲聊');
    await entryEditor.getByLabel('次级关键词').fill('考试');
    await entryEditor.getByLabel('触发逻辑').selectOption('and-all');
    await entryEditor.getByLabel('仅当同学在场').selectOption({ index: 1 });
    await entryEditor.getByLabel('亲密度门槛').fill('60');
    await page.screenshot({ path: info.outputPath('roleplay-entry.png') });

    await workbench.getByRole('button', { name: '保存修改' }).click();
    await expect(workbench.getByText('有未保存的修改')).toHaveCount(0);

    const view = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
    const doc = view.document;
    expect(doc.classroom?.scenario).toBe('开学第一周的晚自习教室。');
    expect(doc.classroom?.studentPersona).toBe('刚转来的学生。');
    const role = doc.classroom?.roles.find(item => item.relations?.length);
    expect(role?.personality).toBe('随和，爱举生活例子。');
    expect(role?.talkativeness).toBe(70);
    expect(role?.greeting).toBe('这道题卡哪儿了？');
    expect(role?.relations?.[0]).toMatchObject({ target: 'student', label: '同桌', intimacy: 55, note: '开学起坐在一起。' });
    const entry = doc.entries.find(item => item.title === '熟络玩笑');
    expect(entry).toMatchObject({ keywords: ['闲聊'], secondaryKeywords: ['考试'], selective: 'and-all', role: role?.id, intimacyAtLeast: 60 });
    expect(errors).toEqual([]);
  } finally {
    await info.attach('browser-console', { body: errors.join('\n'), contentType: 'text/plain' });
  }
});

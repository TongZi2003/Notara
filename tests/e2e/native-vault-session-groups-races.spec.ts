import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

interface RaceControls { release(index: number, success: boolean): void; failReads(value: boolean): void; count(): number }
const controls = async (page: Page, index: number, success: boolean) => page.evaluate(({ index, success }) => {
  (window as unknown as { groupRace: RaceControls }).groupRace.release(index, success);
}, { index, success });

// Real React and the production hook, with deliberately delayed Remote replies.
// Full native Host persistence and the actual dialog shell are covered separately.
async function mount(page: Page) {
  const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createSessionGroupsUI } from './examples/native-vault/session-groups-client.js';
const h = React.createElement, waiting = [];
let failReads = false;
const state = workspaceId => ({ workspaceId, revision: 0, groups: [], members: [] });
const ctx = { remote: { notaraVault: {
  sessionGroups: async ({workspaceId}) => failReads ? {ok:false,error:{message:'temporary read failure'}} : {ok:true,value:state(workspaceId)},
  mutateSessionGroups: input => new Promise(resolve => waiting.push({resolve,input})),
} } };
window.groupRace = {
  count: () => waiting.length,
  failReads: value => { failReads = value; },
  release: (index, success) => {
    const {resolve,input} = waiting[index];
    resolve(success ? {ok:true,value:{...state(input.workspaceId),revision:1}} : {ok:false,error:{code:'session_groups_name_duplicate'}});
  },
};
const {useSessionGroups} = createSessionGroupsUI(React, {
  Dialog: ({title,children}) => h('section', {role:'dialog','aria-label':title}, children),
  Icon: () => null, IconButton: () => null, NativeMenu: () => null,
});
function App() {
  const [workspaceId,setWorkspaceId] = React.useState('A'), groups = useSessionGroups(ctx,workspaceId);
  return h('main', null,
    h('button',{onClick:()=>setWorkspaceId('A')},'切换 A'),
    h('button',{onClick:()=>setWorkspaceId('B')},'切换 B'),
    h('button',{onClick:groups.create,disabled:!groups.ready || groups.busy},'打开分组'),
    h('output',{'data-testid':'group-status'},workspaceId+':'+(groups.ready?'ready':'loading')+':'+(groups.busy?'saving':'idle')),
    groups.status, groups.overlay);
}
createRoot(document.getElementById('root')).render(h(App));
`;
  const result = await build({ stdin: { contents: source, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'js' }, bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: result.outputFiles[0]!.text });
  await expect(page.getByTestId('group-status')).toHaveText('A:ready:idle');
}

for (const success of [true, false]) test(`快速切换目录后旧${success ? '成功' : '失败'}响应不关闭新弹窗或解除新保存`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mount(page);
  await page.getByRole('button', { name: '打开分组', exact: true }).click();
  await page.getByLabel('分组名称').fill('旧请求');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByTestId('group-status')).toHaveText('A:ready:saving');
  await page.getByRole('button', { name: '切换 B', exact: true }).click();
  await expect(page.getByTestId('group-status')).toHaveText('B:ready:idle');
  await page.getByRole('button', { name: '切换 A', exact: true }).click();
  await expect(page.getByTestId('group-status')).toHaveText('A:ready:idle');
  await page.getByRole('button', { name: '打开分组', exact: true }).click();
  await page.getByLabel('分组名称').fill('当前请求');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { groupRace: RaceControls }).groupRace.count())).toBe(2);
  await controls(page, 0, success);
  // Browser task checkpoint lets all promise continuations and React updates run.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  await expect(page.getByRole('dialog', { name: '新建分组', exact: true })).toBeVisible();
  await expect(page.getByLabel('分组名称')).toHaveValue('当前请求');
  await expect(page.getByTestId('group-status')).toHaveText('A:ready:saving');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await controls(page, 1, true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('group-status')).toHaveText('A:ready:idle');
  expect(errors).toEqual([]);
});

test('分组刷新恢复后清除读取告警，并保留需要用户处理的保存错误', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => { (window as unknown as { groupRace: RaceControls }).groupRace.failReads(true); window.dispatchEvent(new Event('focus')); });
  await expect(page.getByRole('alert')).toContainText('分组列表没有读取');
  await page.evaluate(() => { (window as unknown as { groupRace: RaceControls }).groupRace.failReads(false); window.dispatchEvent(new Event('focus')); });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '打开分组', exact: true }).click();
  await page.getByLabel('分组名称').fill('重复名称');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await controls(page, 0, false);
  await expect(page.getByRole('alert')).toContainText('这个分组名称已经存在');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('这个分组名称已经存在');
});

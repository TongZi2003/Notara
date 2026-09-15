import { afterEach, expect, test } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); });
const value = (reply: any): any => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('retired built-in worldbook pins migrate to classroom, preserve user content and stop migrating after the transition', async () => {
  runtime = await startIsolated({ testModel: true }); let client = await connectRuntime(runtime);
  const source = join(runtime.root, 'room-package'); await mkdir(source);
  const prepare = async (version: string, classroom: boolean) => {
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@notara/worldbook', version,
      notara: { apiVersion: 1, title: classroom ? '教室' : '世界书', worldbooks: [{ id: 'worldbook', title: classroom ? '教室' : '世界书', description: classroom ? '成员、世界书与规则' : '编辑背景条目', entry: 'worldbook.json' }] } }));
    await writeFile(join(source, 'worldbook.json'), JSON.stringify({ entries: [], ...(classroom ? { classroom: { title: '教室', roles: [], rules: [], carrySummary: false } } : {}) }));
    return value(await client.rpc('studyforgePlugins/prepare', { input: { kind: 'directory', path: source } }));
  };
  const install = async (version: string, classroom: boolean, expectedVersion: number) => {
    const candidate = await prepare(version, classroom);
    return value(await client.rpc('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion, trustNative: false } }));
  };
  let plugin = await install('1.0.0', false, 0);
  const lesson = value(await client.rpc('studyforgeCreation/openTeacher', {})), target = { ...lesson, id: 'plugin-' + plugin.ref.slice(7) + '-worldbook' };
  expect(value(await client.rpc('studyforgePlugins/openWorkbench', { input: target })).kind).toBe('worldbook');
  const entries = [{ title: '自己的设定', content: '保留用户写过的背景。', keywords: [], enabled: true, always: true }];
  const saved = value(await client.rpc('studyforgePlugins/saveWorldbook', { input: { ...target, expectedVersion: 0, operationId: 'own-world', document: { entries } } }));
  value(await client.rpc('studyforgePlugins/useWorldbook', { input: { ...target, expectedVersion: 0, enabled: true } }));
  plugin = await install('1.1.0', true, plugin.revision);
  const migratedDigest = plugin.digest;
  const choices = value(await client.rpc('studyforgePlugins/workbenches', { input: lesson }));
  expect(choices.find((item: any) => item.id === target.id)).toMatchObject({ title: '教室', digest: migratedDigest, description: '成员、世界书与规则' });
  expect(value(await client.rpc('studyforgePlugins/openWorkbench', { input: target }))).toMatchObject({ kind: 'classroom', title: '教室', digest: migratedDigest });
  const document = value(await client.rpc('studyforgePlugins/readWorldbook', { input: target }));
  expect(document.document.entries).toEqual(entries); expect(document.document.classroom.roles).toEqual([]); expect(document.revision).toBe(saved.revision); expect(document.enabled).toBe(true);
  // Subsequent classroom editions continue to obey the existing fixed-version contract.
  plugin = await install('1.2.0', true, plugin.revision); expect(plugin.digest).not.toBe(migratedDigest);
  expect(value(await client.rpc('studyforgePlugins/openWorkbench', { input: target })).digest).toBe(migratedDigest);
  await runtime.restart(); client = await connectRuntime(runtime);
  expect(value(await client.rpc('studyforgePlugins/openWorkbench', { input: target }))).toMatchObject({ kind: 'classroom', title: '教室', digest: migratedDigest });
  expect(value(await client.rpc('studyforgePlugins/readWorldbook', { input: target })).document.entries).toEqual(entries);
}, 90000);

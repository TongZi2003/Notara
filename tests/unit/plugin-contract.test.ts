import { expect, test } from 'vitest';
import { PluginManifestSchema } from '../../packages/contracts/src/plugins.ts';
import { availableTree, readLayout, dockView, leaves, type WorkspaceView } from '../../packages/client/src/classroom/workspace-layout.ts';
test('plugin contributions reject unknown capability, duplicate ids and escaping paths', () => {
  const input = { name: '@notara/test', version: '1.0.0', notara: { apiVersion: 1, title: '练习', skills: [{ id: 'quiz', title: '出题', entry: 'quiz.md' }] } };
  expect(PluginManifestSchema.safeParse(input).success).toBe(true);
  expect(PluginManifestSchema.safeParse({ ...input, notara: { ...input.notara, worldbooks: [] } }).success).toBe(false);
  for (const entry of ['../escape.md', '/outside.md', 'nested/../../escape.md', 'nested\\outside.md']) expect(PluginManifestSchema.safeParse({ ...input, notara: { ...input.notara, skills: [{ ...input.notara.skills[0], entry }] } }).success).toBe(false);
  expect(PluginManifestSchema.safeParse({ ...input, notara: { ...input.notara, skills: [...input.notara.skills, ...input.notara.skills] } }).success).toBe(false);
});
test('missing plugin views are pruned only from presentation and their saved layout survives', () => {
  const id: WorkspaceView = 'plugin-0123456789abcdef01234567-review';
  const tree = dockView(dockView('chat', 'materials', 'chat', 'right'), id, 'materials', 'bottom');
  const fallback = { tree: 'chat' as const, active: 'chat' as const, visited: ['chat' as const] };
  const saved = readLayout({ tree, active: id, visited: leaves(tree) }, fallback);
  expect(leaves(availableTree(saved.tree, ['chat','materials']))).toEqual(['chat','materials']);
  expect(leaves(availableTree(saved.tree, ['chat','materials',id]))).toEqual(['chat','materials',id]);
  expect(saved.active).toBe(id);
});

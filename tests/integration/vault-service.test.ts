import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StudyForgeVault } from '../../packages/host/src/vault-service.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(): Promise<{ service: StudyForgeVault; root: string }> {
  const base = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'notara-vault-')), root = join(base, 'workspace');
  await mkdir(join(root, 'vault'), { recursive: true });
  const ctx = new Context();
  ctx.reflect.provide('studyforgeAccess', { root } as never);
  cleanups.push(() => rm(base, { recursive: true, force: true }));
  return { service: new StudyForgeVault(ctx), root };
}

test('lists, searches, queries and resolves backlinks in a workspace vault', async () => {
  const { service, root } = await fixture();
  await mkdir(join(root, 'vault/资料'), { recursive: true });
  await writeFile(join(root, 'vault/资料/向量.md'), '---\ntype: card\ntags: [数学]\n---\n# 向量\n');
  await writeFile(join(root, 'vault/路线.md'), '# 路线\n\n下一课是 [[资料/向量]]。\n');
  const listed = await service.list({});
  expect(listed.files.map(file => file.path)).toEqual(['资料/向量.md', '路线.md']);
  expect(listed.tree.children.map(item => item.name)).toEqual(['资料', '路线.md']);
  expect((await service.search({ query: '向量', limit: 10 })).hits.map(hit => hit.path)).toEqual(['资料/向量.md', '路线.md']);
  expect((await service.query({ where: { type: 'card' }, limit: 10 })).map(file => file.path)).toEqual(['资料/向量.md']);
  expect(await service.links({ path: '资料/向量.md' })).toEqual({ outgoing: [], incoming: ['路线.md'] });
});

test('saves atomically and rejects stale revisions and traversal', async () => {
  const { service, root } = await fixture();
  const created = await service.save({ path: '新建/笔记.md', content: '# 初稿\n', expectedRevision: 0 });
  expect(created.title).toBe('初稿');
  expect(await readFile(join(root, 'vault/新建/笔记.md'), 'utf8')).toBe('# 初稿\n');
  await expect(service.save({ path: '新建/笔记.md', content: '# 覆盖\n', expectedRevision: 0 })).rejects.toThrow('VAULT_REVISION_CONFLICT');
  await expect(service.read({ path: '../secret.md' })).rejects.toThrow();
  await expect(service.read({ path: '新建/笔记.txt' })).rejects.toThrow('VAULT_MARKDOWN_REQUIRED');
});

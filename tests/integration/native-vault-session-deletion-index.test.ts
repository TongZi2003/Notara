import { expect, test } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';

interface Confirmation { token: string; title: string }

test('deletion rejects stale confirmation and removes durable full-text rows when search is enabled', async () => {
  const runtime = await startVaultIsolated({ testModel: true });
  let client: VaultHarness | undefined;
  const marker = 'deletionuniquecontentmarker';
  const dbPath = join(runtime.root, 'home', 'deletion-search.sqlite');
  try {
    const patchPath = join(runtime.root, 'home', 'cordis.patch.yml');
    const patch = JSON.parse(await readFile(patchPath, 'utf8')) as unknown[];
    patch.push({ id: 'session-query-sqlite', config: { path: dbPath, openAt: 'first-search' } });
    await writeFile(patchPath, JSON.stringify(patch));
    await runtime.restart();
    client = await connectVault(runtime);
    const target = await client.createSession();
    await client.ask(target, marker, { [marker]: '这条课堂记录将在确认后删除。' });
    await client.rename(target, '索引删除检查');
    const retained = await client.createSession();
    await client.ask(retained, '保留另一课堂', { '保留另一课堂': '保留的独立课堂内容。' });
    await client.rename(retained, '必须保留');
    // Cold sessions populate the durable SQLite tables, rather than only temp.live_docs.
    await client.close(); client = undefined;
    await runtime.restart();
    client = await connectVault(runtime);
    const search = client.value(await client.rpc<{ items: { sessionId: string }[] }>('session/search', { request: { query: marker } }));
    expect(search.items.some(row => row.sessionId === target)).toBe(true);
    function indexedRows(table: 'persisted_sessions' | 'persisted_docs', id: string): number {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'persisted_sessions' ? 'id' : 'session_id'} = ?`).get(id)!.count);
      } finally { db.close(); }
    }
    expect(indexedRows('persisted_sessions', target)).toBe(1);
    expect(indexedRows('persisted_docs', target)).toBeGreaterThan(0);
    const old = client.value(await client.rpc<Confirmation>('notaraSession/previewDeletion', { input: { sessionId: target } }));
    await client.rename(target, '名称已经更新');
    const stale = await client.rpc('notaraSession/deleteConversation', { input: { sessionId: target, token: old.token, typedTitle: old.title } });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.message).toContain('session_delete_confirmation_stale');
    expect((await client.sessions()).some(row => row.sessionId === target)).toBe(true);

    const current = client.value(await client.rpc<Confirmation>('notaraSession/previewDeletion', { input: { sessionId: target } }));
    const mismatch = await client.rpc('notaraSession/deleteConversation', { input: { sessionId: target, token: current.token, typedTitle: current.title + ' ' } });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.message).toContain('session_delete_title_mismatch');
    const deleted = client.value(await client.rpc<{ deleted: boolean; cleanupPending: boolean }>('notaraSession/deleteConversation', { input: { sessionId: target, token: current.token, typedTitle: current.title } }));
    expect(deleted).toMatchObject({ deleted: true, cleanupPending: false });
    // Read SQLite before any further search could independently reconcile stale data.
    expect(indexedRows('persisted_sessions', target)).toBe(0);
    expect(indexedRows('persisted_docs', target)).toBe(0);
    expect(indexedRows('persisted_sessions', retained)).toBe(1);
    const retiredRename = await client.rpc('session/rename', { request: { sessionId: target, title: '不应重新创建已删除课堂' } });
    expect(retiredRename.ok).toBe(false);
    if (!retiredRename.ok) expect(retiredRename.error.message).toContain('session_delete_in_progress');
    await client.rename(retained, '保留课堂仍可修改');
    expect((await client.sessions()).find(row => row.sessionId === retained)?.projections?.values?.title).toBe('保留课堂仍可修改');
    await client.close(); client = undefined;
    await runtime.restart();
    client = await connectVault(runtime);
    expect((await client.sessions()).map(row => row.sessionId)).not.toContain(target);
    expect((await client.sessions()).map(row => row.sessionId)).toContain(retained);
    expect(client.value(await client.rpc<{ items: unknown[] }>('session/search', { request: { query: marker } })).items).toEqual([]);
  } finally {
    await client?.close();
    await runtime.stop();
  }
}, 180_000);

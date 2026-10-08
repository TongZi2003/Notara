import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, basename, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { SessionPage } from '@deepseek-ai/dsh-api-session-controller';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, outcomeJson, toolNames, toolResultTexts, type ToolOutcome, type VaultHarness } from '../fixtures/vault-http.ts';
// @ts-expect-error The Host worker client is plain JS, covered by sibling native tests.
import { ContextHistoryClient } from '../../examples/native-vault/context-history-client.js';

interface NativeEvent { seq: number; type: string; data: unknown }
interface CanonicalRecord { seq: number; type: string; blocks?: { type: string; text?: string }[] }
interface SearchReceipt { hits: { seq: number; part: number; preview: string }[]; recall: string }
interface ReadReceipt { seq: number; format: string; record?: CanonicalRecord; done: boolean }
interface Binding { sessionId: string; bindingHash: string | null; scope: string | null; state: string }
interface ArchiveEvidence { deleted: Binding; retained: Binding; deletedEvents: number; deletedChunks: number; retainedEvents: number }

async function events(host: VaultHarness, sessionId: string): Promise<NativeEvent[]> {
  const cut = host.value(await host.rpc<{ asOfSeq: number }>('session/projections', { request: { sessionId } }));
  return host.value(await host.rpc<SessionPage>('session/page', {
    request: { address: { kind: 'session', sessionId }, throughSeq: cut.asOfSeq, maxMessages: 1000 },
  })).records.flatMap(row => row.type === 'event' ? [row.event] : []);
}
function latest(outcomes: ToolOutcome[], name: string): ToolOutcome {
  const result = outcomes.findLast(row => row.name === name);
  expect(result, `native ${name} completed`).toBeDefined();
  return result!;
}
function json<T>(outcomes: ToolOutcome[], name: string): T {
  const result = latest(outcomes, name);
  expect(result.failed, result.text).toBe(false);
  const value = outcomeJson<T>(result);
  expect(value, `native ${name} returned JSON`).toBeDefined();
  return value!;
}

// SQLite remains in a worker. A consistent backup lets the test inspect the
// committed deletion after the isolated runtime has stopped and removed its root.
async function snapshotArchive(source: string, snapshot: string, deleted: string, retained: string): Promise<ArchiveEvidence> {
  const code = `const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync, backup } = require('node:sqlite');
    (async () => {
      const db = new DatabaseSync(workerData.source, { readOnly: true });
      try {
        const binding = id => db.prepare('SELECT * FROM sessionBindings WHERE sessionId=?').get(id);
        const count = (table, id) => Number(db.prepare('SELECT COUNT(*) AS count FROM ' + table + ' WHERE scope IN (SELECT scope FROM scopeOwners WHERE sessionId=?)').get(id).count);
        const result = { deleted: binding(workerData.deleted), retained: binding(workerData.retained),
          deletedEvents: count('events', workerData.deleted), deletedChunks: count('chunks', workerData.deleted), retainedEvents: count('events', workerData.retained) };
        await backup(db, workerData.snapshot);
        parentPort.postMessage(result);
      } finally { db.close(); }
    })().catch(error => { throw error; });`;
  return new Promise((accept, reject) => {
    const worker = new Worker(code, { eval: true, workerData: { source, snapshot, deleted, retained } });
    let result: ArchiveEvidence | undefined;
    worker.once('message', value => { result = value as ArchiveEvidence; });
    worker.once('error', reject);
    worker.once('exit', code => code === 0 && result ? accept(result) : reject(new Error(`archive evidence worker exited ${code}`)));
  });
}

test('real native compaction retrieves originals through model tools across fork/restart and committed deletion', async () => {
  const runtime = await startVaultIsolated({ testModel: true });
  let host = await connectVault(runtime);
  const evidenceDir = await mkdtemp(join(tmpdir(), 'notara-history-integration-'));
  const snapshot = join(evidenceDir, 'history.sqlite');
  let archived: InstanceType<typeof ContextHistoryClient> | undefined;
  const token = 'RECOVERY_TOKEN_48271';
  const privateDetail = '原始约定：测量误差为0.037厘米，学生要求先验证绿色标签。';
  const original = `${token}\n${privateDetail}\n这是压缩后必须核对的原话。`;
  const futureToken = 'PARENT_FUTURE_57284';
  const futureDetail = '这个结论只属于分支建立后父课堂的蓝色标签。';
  try {
    const parent = await host.createSession();
    await host.scriptOne('历史归档预热', '预热完成。'); await host.ask(parent, '历史归档预热');
    await host.scriptOne(original, '已保留这次原始约定。');
    await host.ask(parent, original);
    const log = await events(host, parent);
    const originalEvent = log.find(row => row.type === 'user/message' && JSON.stringify(row.data).includes(token));
    expect(originalEvent).toBeDefined();
    const seq = originalEvent!.seq;
    await host.scriptOne('继续讨论下一步', '继续讨论。'); await host.ask(parent, '继续讨论下一步');
    const compact = host.value(await host.rpc('commands/execute', { agentId: parent, line: '/compact', submittedAttachments: [] }));
    expect(JSON.stringify(compact)).toContain('Compacted');
    const compacted = await events(host, parent);
    const summary = compacted.findLast(row => row.type === 'compaction/summary');
    expect(summary).toBeDefined();
    expect((summary!.data as { shadowedSeqs: number[] }).shadowedSeqs).toContain(seq);
    expect(JSON.stringify(summary!.data)).not.toContain(token);
    await host.scriptOne('检查压缩后的当前上下文', '压缩后继续。');
    const [afterCompact] = await host.ask(parent, '检查压缩后的当前上下文');
    expect(JSON.stringify(afterCompact!.messages)).not.toContain(token);
    expect(JSON.stringify(afterCompact!.messages)).not.toContain(privateDetail);
    expect(afterCompact!.messages.some(message => message.source?.kind === 'compact-checkpoint')).toBe(true);
    expect(toolNames(afterCompact!)).toEqual(expect.arrayContaining(['history_search', 'history_read']));

    const retrieve = '回读原始约定';
    await host.scriptOne(retrieve, { calls: [
      { name: 'history_search', arguments: { query: token } },
      { name: 'history_read', arguments: { seq } },
    ], text: '已用原始记录核对约定。' });
    const recovered = await host.ask(parent, retrieve);
    const outcomes = await host.outcomes(parent), search = json<SearchReceipt>(outcomes, 'history_search');
    expect(search.hits.some(hit => hit.seq === seq && hit.preview.includes('0.037'))).toBe(true);
    expect(search.recall).toContain('incomplete recall');
    const read = json<ReadReceipt>(outcomes, 'history_read');
    expect(read).toMatchObject({ seq, format: 'canonical-record', done: true });
    expect(read.record?.blocks?.map(block => block.text ?? '').join('')).toBe(original);
    expect(toolResultTexts(recovered.at(-1)!).join('\n')).toContain(privateDetail);
    expect(JSON.stringify(recovered[0]!.messages)).not.toContain(privateDetail);

    const foreign = await host.createSession(), foreignToken = 'FOREIGN_SCOPE_63915';
    await host.scriptOne(foreignToken, '这节课有自己的独立内容。'); await host.ask(foreign, foreignToken);
    const crossRead = '检查本课堂历史边界';
    await host.scriptOne(crossRead, { calls: [
      { name: 'history_search', arguments: { query: token } },
      { name: 'history_read', arguments: { seq } },
    ], text: '完成本课堂边界检查。' });
    const crossRequests = await host.ask(foreign, crossRead);
    expect(JSON.stringify(crossRequests.flatMap(row => row.messages))).not.toContain(privateDetail);
    const foreignOutcomes = await host.outcomes(foreign);
    const foreignSearch = json<SearchReceipt>(foreignOutcomes, 'history_search');
    // Its current search invocation can itself match its query; it cannot recover the parent's evidence.
    expect(foreignSearch.hits).toEqual([]);
    expect(latest(foreignOutcomes, 'history_read').text).not.toContain(privateDetail);

    const child = host.value(await host.rpc<{ sessionId: string }>('session/fork', { request: { sessionId: parent } })).sessionId;
    const future = `${futureToken}: ${futureDetail}`;
    await host.scriptOne(future, '父课堂继续。'); await host.ask(parent, future);
    await host.scriptOne('分支回读原始记录', { calls: [
      { name: 'history_read', arguments: { seq } },
      { name: 'history_search', arguments: { query: futureToken } },
    ], text: '分支只核对自己的继承记录。' });
    await host.ask(child, '分支回读原始记录');
    const childOutcomes = await host.outcomes(child);
    expect(json<ReadReceipt>(childOutcomes, 'history_read').record?.blocks?.map(block => block.text ?? '').join('')).toBe(original);
    expect(json<SearchReceipt>(childOutcomes, 'history_search').hits).toEqual([]);

    await host.close(); await runtime.restart(); host = await connectVault(runtime);
    await host.scriptOne('重启后再次回读', { calls: [{ name: 'history_read', arguments: { seq } }], text: '重启后仍能核对原话。' });
    await host.ask(child, '重启后再次回读');
    expect(json<ReadReceipt>(await host.outcomes(child), 'history_read').record?.blocks?.map(block => block.text ?? '').join('')).toBe(original);

    const confirmation = host.value(await host.rpc<{ token: string; title: string }>('notaraSession/previewDeletion', { input: { sessionId: foreign } }));
    const deletion = host.value(await host.rpc('notaraSession/deleteConversation', {
      input: { sessionId: foreign, token: confirmation.token, typedTitle: confirmation.title },
    }));
    expect(deletion).toMatchObject({ deleted: true, cleanupPending: false });
    expect((await host.sessions()).map(row => row.sessionId)).not.toContain(foreign);
    expect((await host.sessions()).map(row => row.sessionId)).toEqual(expect.arrayContaining([parent, child]));
    const evidence = await snapshotArchive(join(runtime.root, 'home', 'notara-history', 'history.sqlite'), snapshot, foreign, child);
    expect(evidence.deleted).toMatchObject({ state: 'deleted', bindingHash: null, scope: null });
    expect(evidence.deletedEvents).toBe(0); expect(evidence.deletedChunks).toBe(0);
    expect(evidence.retained).toMatchObject({ state: 'active' });
    expect(evidence.retainedEvents).toBeGreaterThan(0);
    await host.close(); await runtime.stop();
    archived = new ContextHistoryClient({ path: snapshot });
    await expect(archived.bindSession(foreign, evidence.retained.bindingHash!)).rejects.toMatchObject({ code: 'SESSION_DELETED' });
    const retained = await archived.bindSession(child, evidence.retained.bindingHash!);
    const page = await archived.page(retained.scope, retained.generation, seq);
    expect(JSON.parse(page.rows.map((row: { body: string }) => row.body).join(''))).toMatchObject({ seq, type: 'user/message' });
    expect(page.rows.map((row: { body: string }) => row.body).join('')).toContain('0.037');
  } finally {
    await archived?.close(); await host.close(); await runtime.stop();
    const path = resolve(evidenceDir);
    if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith('notara-history-integration-')) throw new Error('unexpected history evidence path');
    await rm(path, { recursive: true, force: true });
  }
}, 180_000);

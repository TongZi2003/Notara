import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, test } from 'vitest';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type ScriptedReply, type VaultHarness } from '../fixtures/vault-http.ts';
// @ts-expect-error board-runtime.js is covered by its sibling JavaScript tests.
import { boardPath } from '../../examples/native-vault/board-runtime.js';

const CLIENT_COUNT = 12;
const CAS_WRITERS_PER_SESSION = 3;
const DELETE_PAGE_READERS = 8;
const DELETE_LIST_READERS = 4;
const RUN_TIMEOUT_MS = 45_000;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type SessionRow = { sessionId: string; running?: boolean; blank?: boolean };
type SessionPage = { records: Array<{ type: string; event?: { type?: string } }> };
type SessionList = { items: SessionRow[] };
type BoardValue = {
  revision: string | null;
  blocks: Array<{ id: string; width?: number; height?: number; body: string }>;
  sources?: Array<{ path: string }>;
};
type BoardMutationInput = { sessionId: string; expectedRevision: string | null; blockId: string; patch: Record<string, number> };
type DeletionPreview = { token: string; title: string };
type Result<T> = { ok: true; value: T } | { ok: false; error: { code?: string; message: string } };

interface RpcSample {
  operation: string;
  client: number;
  durationMs: number;
  status: 'ok' | 'remote-error' | 'transport-error';
  code?: string;
  detail?: string;
}

function errorKey(error: { code?: string; message?: string } | Error): string {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  const explicit = `${code} ${message}`.match(/(?:session_delete|vault_revision)_[a-z_]+/i)?.[0];
  return (explicit ?? code) || ('name' in error && typeof error.name === 'string' ? error.name : 'remote_error');
}

function requireValue<T>(result: Result<T>, operation: string): T {
  if (!result.ok) throw new Error(`${operation}:${errorKey(result.error)}`);
  return result.value;
}

function isRevisionConflictText(value: string): boolean {
  return /revision[_ -]?conflict|资料已被修改/i.test(value);
}

function isCasConflict(result: Result<unknown>): boolean {
  if (result.ok) return false;
  return isRevisionConflictText(`${result.error.code ?? ''} ${result.error.message}`);
}

function isExpectedPageMiss(result: Result<unknown>): boolean {
  if (result.ok) return true;
  const value = errorKey(result.error);
  return /session_delete_(?:in_progress|not_found)/i.test(value)
    || /(?:not found|not_found|in progress)/i.test(result.error.message);
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!.toFixed(2));
}

function summarize(samples: RpcSample[]) {
  const byOperation: Record<string, { requests: number; ok: number; errors: Record<string, number>; latencyMs: { p50: number | null; p95: number | null; p99: number | null; max: number | null } }> = {};
  for (const sample of samples) {
    const current = byOperation[sample.operation] ??= { requests: 0, ok: 0, errors: {}, latencyMs: { p50: null, p95: null, p99: null, max: null } };
    current.requests++;
    if (sample.status === 'ok') current.ok++;
    else {
      const key = sample.code ?? sample.status;
      current.errors[key] = (current.errors[key] ?? 0) + 1;
    }
  }
  for (const [operation, current] of Object.entries(byOperation)) {
    const values = samples.filter(sample => sample.operation === operation).map(sample => sample.durationMs);
    current.latencyMs = {
      p50: percentile(values, .50), p95: percentile(values, .95), p99: percentile(values, .99),
      max: Number(Math.max(...values).toFixed(2)),
    };
  }
  return byOperation;
}

test('isolated Native Vault survives concurrent sessions, turns, CAS writes, deletion races, and restart', async () => {
  const startedAt = new Date().toISOString();
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const samples: RpcSample[] = [];
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];
  const unexpected: string[] = [];
  const turnDurationsMs: number[] = [];
  let rpcRequests = 0;
  let runtime: Awaited<ReturnType<typeof startVaultIsolated>> | undefined;
  let clients: VaultHarness[] = [];
  let sessionIds: string[] = [];
  const deletedIds = new Set<string>();
  const casSuccesses = new Map<string, Array<{ width: number; height: number }>>();
  let reportPath = '';

  const recordCheck = (name: string, passed: boolean, detail?: string): void => {
    checks.push({ name, passed, ...(detail ? { detail } : {}) });
    if (!passed) unexpected.push(`${name}${detail ? `: ${detail}` : ''}`);
  };

  const rpc = async <T>(clientIndex: number, operation: string, method: string, args: unknown): Promise<Result<T>> => {
    const started = performance.now(); rpcRequests++;
    try {
      const result = await clients[clientIndex]!.rpc<T>(method, args);
      const durationMs = Number((performance.now() - started).toFixed(2));
      const code = result.ok ? undefined : errorKey(result.error);
      const detail = result.ok ? undefined : safeErrorDetail(result.error.message);
      samples.push({ operation, client: clientIndex, durationMs, status: result.ok ? 'ok' : 'remote-error', ...(code ? { code } : {}), ...(detail ? { detail } : {}) });
      return result;
    } catch (error) {
      const durationMs = Number((performance.now() - started).toFixed(2));
      const detail = error instanceof Error ? safeErrorDetail(error.message) : 'unknown transport error';
      samples.push({ operation, client: clientIndex, durationMs, status: 'transport-error', code: error instanceof Error ? errorKey(error) : 'transport-error', detail });
      throw error;
    }
  };

  const safeErrorDetail = (message: string): string => {
    let detail = message;
    if (runtime) detail = detail.replaceAll(new URL(runtime.authUrl).origin, '<isolated-origin>').replaceAll(runtime.root, '<isolated-root>');
    return detail.replace(/(?:[A-Z]:\\|\\\\)[^\s"'<>]+/gi, '<path>').slice(0, 320);
  };

  const listSessions = async (clientIndex: number, operation = 'session-list'): Promise<SessionRow[]> => {
    const result = requireValue(await rpc<SessionList>(clientIndex, operation, 'session/list', { _request: {} }), operation);
    return result.items;
  };

  const page = async (clientIndex: number, sessionId: string, operation = 'session-page'): Promise<Result<SessionPage>> => {
    const address = { kind: 'session', sessionId };
    // Match the fixture's cursor discovery: -1 is before the first event, not latest.
    const boundary = await rpc<SessionPage>(clientIndex, 'session-page-cursor-probe', 'session/page', {
      request: { address, throughSeq: 1_000_000, maxMessages: 1 },
    });
    const cursor = boundary.ok ? -1 : Number(/past cursor (-?\d+)/i.exec(boundary.error.message)?.[1] ?? -1);
    return rpc<SessionPage>(clientIndex, operation, 'session/page', {
      request: { address, throughSeq: cursor, maxMessages: 100 },
    });
  };

  const waitForTurn = async (clientIndex: number, sessionId: string, previousTurns: number): Promise<void> => {
    const turnStarted = performance.now(), deadline = Date.now() + RUN_TIMEOUT_MS;
    for (;;) {
      const [rows, turns] = await Promise.all([
        listSessions(clientIndex, 'session-list-turn-poll'),
        clients[clientIndex]!.turns(sessionId),
      ]);
      const row = rows.find(item => item.sessionId === sessionId);
      if (turns.length > previousTurns && row?.running !== true) {
        turnDurationsMs.push(Number((performance.now() - turnStarted).toFixed(2)));
        return;
      }
      if (Date.now() >= deadline) throw new Error(`turn_timeout:${row?.running === true ? 'running' : 'not_started'}`);
      await delay(100);
    }
  };

  const startPrompt = async (clientIndex: number, sessionId: string, text: string): Promise<number> => {
    const before = (await clients[clientIndex]!.turns(sessionId)).length;
    const result = await rpc<{ queued?: boolean }>(clientIndex, 'session-prompt', 'session/prompt', {
      request: { sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text }] },
    });
    requireValue(result, 'session-prompt');
    return before;
  };

  const writeReport = async (): Promise<void> => {
    const directory = join(process.cwd(), '.runtime');
    await mkdir(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    reportPath = join(directory, `native-vault-stress-${stamp}.json`);
    const counts = summarize(samples);
    const expectedCasConflicts = samples.filter(sample => sample.operation === 'board-cas-write' && sample.status === 'remote-error' && isRevisionConflictText(`${sample.code ?? ''} ${sample.detail ?? ''}`)).length;
    const expectedActiveDeletionBlocks = samples.filter(sample => sample.operation === 'active-delete-preview' && sample.status === 'remote-error' && /session_delete_active/i.test(sample.code ?? '')).length;
    const cursorProbeOutOfRange = samples.filter(sample => sample.operation === 'session-page-cursor-probe' && sample.code === 'gateway/bad-request').length;
    const cursorProbeDeleteBarriers = samples.filter(sample => sample.operation === 'session-page-cursor-probe' && sample.code === 'session_delete_in_progress').length;
    const cursorProbeDeletedSessions = samples.filter(sample => sample.operation === 'session-page-cursor-probe' && sample.code === 'session/not-found').length;
    const deletionRacePageBarriers = samples.filter(sample => sample.operation.startsWith('delete-race-page-') && sample.code === 'session_delete_in_progress').length;
    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      profile: {
        clients: CLIENT_COUNT,
        sessionsCreated: sessionIds.length,
        concurrentModelTurns: CLIENT_COUNT,
        casWritersPerSession: CAS_WRITERS_PER_SESSION,
        concurrentDeletePageReaders: DELETE_PAGE_READERS,
        concurrentDeleteListReaders: DELETE_LIST_READERS,
        syntheticProvider: true,
        isolatedDataRoot: runtime?.root ?? null,
      },
      requestCount: rpcRequests,
      requestsByOperation: counts,
      completedTurnLatencyMs: { p50: percentile(turnDurationsMs, .50), p95: percentile(turnDurationsMs, .95), max: turnDurationsMs.length ? Number(Math.max(...turnDurationsMs).toFixed(2)) : null },
      expected: {
        casConflicts: expectedCasConflicts,
        activeDeleteBlocks: expectedActiveDeletionBlocks,
        cursorProbeOutOfRange,
        cursorProbeDeleteBarriers,
        cursorProbeDeletedSessions,
        deletionRacePageBarriers,
        deletedSessions: deletedIds.size,
      },
      checks,
      unexpectedErrors: unexpected,
      samples,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  };

  try {
    runtime = await startVaultIsolated({ testModel: true });
    const connected = await Promise.all(Array.from({ length: CLIENT_COUNT }, async (_, index) => {
      const started = performance.now();
      const client = await connectVault(runtime!);
      const durationMs = Number((performance.now() - started).toFixed(2));
      samples.push({ operation: 'client-connect', client: index, durationMs, status: 'ok' });
      client.approvals.auto('allowed-once');
      return client;
    }));
    clients = connected;

    const replies: Record<string, ScriptedReply> = {};
    const prompts = Array.from({ length: CLIENT_COUNT }, (_, index) => `STRESS-${runId}-TURN-${index}`);
    for (const [index, prompt] of prompts.entries()) {
      replies[prompt] = {
        calls: [{ name: 'write_lesson_board', arguments: {
          title: `并发白板 ${runId}-${index}`,
          section: '隔离压力测试',
          body: `合成压力测试校验内容 Marker=${runId}-${index}`,
        } }],
        text: '合成板书已保存。',
      };
    }
    // Seed the shared synthetic provider table once; parallel turns never race its file rewrite.
    await clients[0]!.script(replies);

    const workspaceResult = requireValue(await rpc<{ workspace: { workspaceId: string } }>(0, 'workspace-create', 'workspace/create', {
      request: { path: clients[0]!.workspace },
    }), 'workspace-create');
    const workspaceId = workspaceResult.workspace.workspaceId;
    recordCheck('native-workspace-created', typeof workspaceId === 'string' && workspaceId.length > 0);

    const creates = await Promise.all(clients.map((_, index) => rpc<{ sessionId: string }>(index, 'session-create', 'session/create', {
      request: { workspaceId, agentPreset: 'notara-teacher' },
    })));
    sessionIds = creates.map((result, index) => requireValue(result, `session-create-${index}`).sessionId);
    recordCheck('concurrent-session-ids-unique', new Set(sessionIds).size === CLIENT_COUNT, `created=${sessionIds.length}`);

    const initialLists = await Promise.all(clients.map((_, index) => listSessions(index, 'session-list-initial')));
    recordCheck('concurrent-list-sees-created-sessions', initialLists.every(rows => sessionIds.every(id => rows.some(row => row.sessionId === id))), `clients=${initialLists.length}`);

    const promptStarts = await Promise.all(sessionIds.map((sessionId, index) => startPrompt(index, sessionId, prompts[index]!)));
    await Promise.all(sessionIds.map((sessionId, index) => waitForTurn(index, sessionId, promptStarts[index]!)));
    recordCheck('all-scripted-model-turns-settled', turnDurationsMs.length === CLIENT_COUNT, `completed=${turnDurationsMs.length}`);

    const boardSnapshots = await Promise.all(sessionIds.map(async (sessionId, index) => {
      const result = requireValue(await rpc<BoardValue>(index, 'board-read', 'notaraVault/board', { input: { sessionId } }), 'board-read');
      return result;
    }));
    recordCheck('model-turns-created-all-whiteboards', boardSnapshots.every(board => board.blocks.length === 1), `boards=${boardSnapshots.length}`);

    const casTasks = sessionIds.flatMap((sessionId, index) => {
      const initial = boardSnapshots[index]!;
      const block = initial.blocks[0];
      if (!block || !initial.revision) {
        unexpected.push(`board-cas-precondition-${index}`);
        return [];
      }
      const candidates = Array.from({ length: CAS_WRITERS_PER_SESSION }, (_, writer) => ({
        width: 230 + writer * 83,
        height: 100 + writer * 57,
      }));
      casSuccesses.set(sessionId, candidates);
      return candidates.map((dimensions, writer) => ({ sessionId, client: index, writer, expectedRevision: initial.revision, blockId: block.id, dimensions }));
    });
    const casResults = await Promise.all(casTasks.map(task => rpc<BoardValue>(task.client, 'board-cas-write', 'notaraVault/mutateBoard', {
      input: {
        sessionId: task.sessionId,
        expectedRevision: task.expectedRevision,
        blockId: task.blockId,
        patch: { x: 900 + task.client * 12, y: 160 + task.client * 12, ...task.dimensions },
      } satisfies BoardMutationInput,
    })));
    const successCount = casResults.filter(result => result.ok).length;
    const conflictCount = casResults.filter(isCasConflict).length;
    recordCheck('whiteboard-cas-one-winner-per-session', successCount === CLIENT_COUNT && conflictCount === CLIENT_COUNT * (CAS_WRITERS_PER_SESSION - 1), `success=${successCount},revisionConflicts=${conflictCount}`);

    const afterCas = await Promise.all(sessionIds.map(async (sessionId, index) =>
      requireValue(await rpc<BoardValue>(index, 'board-read-after-cas', 'notaraVault/board', { input: { sessionId } }), 'board-read-after-cas')));
    recordCheck('whiteboard-cas-dimensions-durable', afterCas.every((board, index) => {
      const block = board.blocks[0], candidates = casSuccesses.get(sessionIds[index]!);
      return !!block && candidates?.some(candidate => candidate.width === block.width && candidate.height === block.height) === true;
    }), 'every board matches one committed resize');

    const preDeletePages = await Promise.all(sessionIds.map((sessionId, index) => page(index, sessionId, 'session-page-before-delete')));
    recordCheck('all-created-sessions-readable', preDeletePages.every(result => result.ok && result.value.records.length > 0), `readable=${preDeletePages.filter(result => result.ok).length}`);

    const activeIndex = 1, activeId = sessionIds[activeIndex]!;
    const activePrompt = `STRESS-${runId}-ACTIVE-GUARD`;
    await clients[0]!.scriptOne(activePrompt, { text: '这轮合成检查稍后完成。', pauseMs: 700 });
    const activeStart = await startPrompt(activeIndex, activeId, activePrompt);
    let activeObserved = false;
    const activeDeadline = Date.now() + 8_000;
    while (Date.now() < activeDeadline) {
      const row = (await listSessions(activeIndex, 'session-list-active-poll')).find(item => item.sessionId === activeId);
      if (row?.running) { activeObserved = true; break; }
      await delay(50);
    }
    recordCheck('active-session-observed-before-delete-preview', activeObserved);
    const activePreview = await rpc<DeletionPreview>(activeIndex, 'active-delete-preview', 'notaraSession/previewDeletion', { input: { sessionId: activeId } });
    recordCheck('active-session-delete-is-rejected', !activePreview.ok && /session_delete_active/i.test(errorKey(activePreview.error)), activePreview.ok ? 'preview unexpectedly succeeded' : errorKey(activePreview.error));
    await waitForTurn(activeIndex, activeId, activeStart);

    const deleteTargets = [0, CLIENT_COUNT - 1];
    const deleteWithQueryRace = async (targetIndex: number): Promise<void> => {
      const sessionId = sessionIds[targetIndex]!;
      const preview = requireValue(await rpc<DeletionPreview>(targetIndex, 'delete-preview', 'notaraSession/previewDeletion', { input: { sessionId } }), 'delete-preview');
      const queryIndices = Array.from({ length: DELETE_PAGE_READERS }, (_, offset) => (targetIndex + 1 + offset) % CLIENT_COUNT);
      const pageReads = queryIndices.map((clientIndex, index) => page(clientIndex, sessionId, `delete-race-page-${index}`));
      const listReads = Array.from({ length: DELETE_LIST_READERS }, (_, index) => listSessions((targetIndex + index + 2) % CLIENT_COUNT, `delete-race-list-${index}`));
      const deletion = rpc<{ deleted: boolean; linkedCount: number; cleanupPending: boolean }>(targetIndex, 'delete-conversation-race', 'notaraSession/deleteConversation', {
        input: { sessionId, token: preview.token, typedTitle: preview.title },
      });
      const [pageResults, listResults, deleteResult] = await Promise.all([
        Promise.all(pageReads), Promise.all(listReads), deletion,
      ]);
      recordCheck(`delete-race-page-reads-are-consistent-${targetIndex}`, pageResults.every(isExpectedPageMiss), `results=${pageResults.map(result => result.ok ? 'ok' : errorKey(result.error)).join(',')}`);
      recordCheck(`delete-race-lists-remain-readable-${targetIndex}`, listResults.length === DELETE_LIST_READERS, `lists=${listResults.length}`);
      let deleted = deleteResult.ok;
      if (!deleteResult.ok && /session_delete_session_reading/i.test(errorKey(deleteResult.error))) {
        const retryPreview = requireValue(await rpc<DeletionPreview>(targetIndex, 'delete-retry-preview', 'notaraSession/previewDeletion', { input: { sessionId } }), 'delete-retry-preview');
        const retry = await rpc<{ deleted: boolean; cleanupPending: boolean }>(targetIndex, 'delete-retry', 'notaraSession/deleteConversation', {
          input: { sessionId, token: retryPreview.token, typedTitle: retryPreview.title },
        });
        deleted = retry.ok;
        recordCheck(`delete-reader-barrier-retry-${targetIndex}`, retry.ok, retry.ok ? undefined : errorKey(retry.error));
      } else if (!deleteResult.ok) {
        recordCheck(`delete-race-conversation-${targetIndex}`, false, errorKey(deleteResult.error));
      }
      if (deleted) deletedIds.add(sessionId);
    };
    await Promise.all(deleteTargets.map(deleteWithQueryRace));
    recordCheck('concurrent-deletions-completed', deletedIds.size === deleteTargets.length, `deleted=${deletedIds.size}`);

    const finalRows = await listSessions(0, 'session-list-after-delete');
    recordCheck('deleted-sessions-disappear-from-list', [...deletedIds].every(id => !finalRows.some(row => row.sessionId === id)), `remaining=${finalRows.filter(row => sessionIds.includes(row.sessionId)).length}`);
    const deletedPages = await Promise.all([...deletedIds].map((sessionId, index) => page(index, sessionId, 'session-page-after-delete')));
    recordCheck('deleted-sessions-no-longer-readable', deletedPages.every(result => !result.ok), `readable=${deletedPages.filter(result => result.ok).length}`);

    for (const client of clients) await client.close();
    clients = [];
    const restartStarted = performance.now();
    await runtime.restart();
    samples.push({ operation: 'runtime-restart', client: 0, durationMs: Number((performance.now() - restartStarted).toFixed(2)), status: 'ok' });
    clients = await Promise.all(Array.from({ length: CLIENT_COUNT }, async (_, index) => {
      const started = performance.now();
      const client = await connectVault(runtime!);
      samples.push({ operation: 'client-reconnect', client: index, durationMs: Number((performance.now() - started).toFixed(2)), status: 'ok' });
      client.approvals.auto('allowed-once');
      return client;
    }));

    const restartedLists = await Promise.all(clients.map((_, index) => listSessions(index, 'session-list-after-restart')));
    const persistedIds = restartedLists[0]!.map(row => row.sessionId);
    const activeIds = sessionIds.filter(id => !deletedIds.has(id));
    recordCheck('restart-keeps-all-nondeleted-sessions', activeIds.every(id => persistedIds.includes(id)), `active=${activeIds.length}`);
    recordCheck('restart-does-not-restore-deleted-sessions', [...deletedIds].every(id => !persistedIds.includes(id)), `deleted=${deletedIds.size}`);

    const restartedPages = await Promise.all(activeIds.map((sessionId, index) => page(index % CLIENT_COUNT, sessionId, 'session-page-after-restart')));
    recordCheck('restart-kept-session-pages-readable', restartedPages.every(result => result.ok && result.value.records.length > 0), `readable=${restartedPages.filter(result => result.ok).length}`);
    const restartedBoards = await Promise.all(activeIds.map(async (sessionId, index) => {
      const result = await rpc<BoardValue>(index % CLIENT_COUNT, 'board-read-after-restart', 'notaraVault/board', { input: { sessionId } });
      return result.ok ? result.value : undefined;
    }));
    recordCheck('restart-keeps-whiteboard-resize-and-content', restartedBoards.every((board, index) => {
      const sessionId = activeIds[index]!;
      const current = board?.blocks[0];
      const candidates = casSuccesses.get(sessionId);
      return !!current && candidates?.some(candidate => candidate.width === current.width && candidate.height === current.height) === true
        && current.body.includes(`Marker=${runId}-`);
    }), `boards=${restartedBoards.filter(Boolean).length}`);
    for (const sessionId of sessionIds) {
      const marker = sessionIds.indexOf(sessionId);
      const document = await clients[0]!.readVaultFile(boardPath(sessionId));
      recordCheck(`vault-board-material-survives-${marker}`, document.includes(`Marker=${runId}-${marker}`), `deleted=${deletedIds.has(sessionId)}`);
    }

    const postRestartDeletedPages = await Promise.all([...deletedIds].map((sessionId, index) => page(index, sessionId, 'deleted-page-after-restart')));
    recordCheck('restart-deleted-session-logs-remain-absent', postRestartDeletedPages.every(result => !result.ok), `readable=${postRestartDeletedPages.filter(result => result.ok).length}`);
  } catch (error) {
    unexpected.push(error instanceof Error ? error.message : 'unknown stress failure');
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    try { await runtime?.stop(); }
    catch (error) { unexpected.push(error instanceof Error ? `runtime-stop:${errorKey(error)}` : 'runtime-stop:failed'); }
    await writeReport();
  }

  // Expected revision conflicts and read barriers remain visible in the JSON
  // metrics, but only unexpected failures make the stress lane fail.
  expect(unexpected, `stress report: ${reportPath}`).toEqual([]);
  expect(checks.filter(check => !check.passed).map(check => check.name), `stress report: ${reportPath}`).toEqual([]);
  expect(rpcRequests, `stress report: ${reportPath}`).toBeGreaterThanOrEqual(100);
  process.stdout.write(`Native Vault stress report: ${reportPath}\n`);
});

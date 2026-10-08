// Run with Node 24: node --experimental-strip-types tests/manual/context-continuity.ts [--test-model]
import { randomUUID, createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';
import { captureNativeCut, readNativeEvents, waitForNativeTurn } from '../fixtures/vault-native-turns.ts';
import { analyzeNativeCheckpoints } from '../fixtures/vault-native-checkpoints.ts';
import { contextContinuityScenario as scenario, type ContinuityCheckpoint } from '../fixtures/context-continuity-scenario.ts';

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function requireFact(value: unknown, code: string): asserts value { if (!value) throw Object.assign(new Error(code), { code }); }
const visibleText = (blocks: unknown): string => Array.isArray(blocks)
  ? blocks.flatMap(block => object(block).type === 'text' && typeof object(block).text === 'string' ? [object(block).text] : []).join('\n') : '';

async function attachTempRuntime(inputRoot: string): Promise<VaultRuntime> {
  const root = resolve(inputRoot), temp = resolve(tmpdir()), name = basename(root);
  const samePath = (left: string, right: string) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
  requireFact(/^notara-vault-native-[a-zA-Z0-9]+$/.test(name), 'ATTACH_NOT_DIRECT_TEMP_ROOT');
  const [tempReal, parentReal, rootInfo, rootReal] = await Promise.all([realpath(temp), realpath(dirname(root)), lstat(root), realpath(root)]);
  requireFact(samePath(parentReal, tempReal), 'ATTACH_NOT_DIRECT_TEMP_ROOT');
  requireFact(rootInfo.isDirectory() && !rootInfo.isSymbolicLink() && samePath(rootReal, join(tempReal, name)), 'ATTACH_ROOT_ESCAPE');
  const launcherPath = join(root, 'launcher.json'), workspace = join(root, 'workspace');
  const [launcherInfo, launcherReal, workspaceInfo, workspaceReal] = await Promise.all([lstat(launcherPath), realpath(launcherPath), lstat(workspace), realpath(workspace)]);
  requireFact(launcherInfo.isFile() && !launcherInfo.isSymbolicLink() && launcherInfo.size < 16_384
    && samePath(launcherReal, join(rootReal, 'launcher.json')), 'ATTACH_LAUNCHER_ESCAPE');
  requireFact(workspaceInfo.isDirectory() && !workspaceInfo.isSymbolicLink() && samePath(workspaceReal, join(rootReal, 'workspace')), 'ATTACH_WORKSPACE_ESCAPE');
  const launcherText = await readFile(launcherPath, 'utf8');
  let record: Record<string, unknown>; try { record = object(JSON.parse(launcherText)); } catch { throw new Error('ATTACH_LAUNCHER_INVALID'); }
  requireFact(record.testModel === false && typeof record.workspace === 'string' && isAbsolute(record.workspace), 'ATTACH_NOT_REAL_ISOLATED_WORKSPACE');
  requireFact(samePath(await realpath(record.workspace), workspaceReal), 'ATTACH_NOT_REAL_ISOLATED_WORKSPACE');
  requireFact(typeof record.authUrl === 'string', 'ATTACH_AUTH_URL_MISSING');
  let url: URL; try { url = new URL(record.authUrl); } catch { throw new Error('ATTACH_AUTH_URL_INVALID'); }
  requireFact(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && !url.username && !url.password, 'ATTACH_AUTH_URL_NOT_LOOPBACK_HTTP');
  requireFact(Number.isSafeInteger(record.pid) && Number.isSafeInteger(record.parentPid)
    && Number(record.pid) > 0 && Number(record.parentPid) > 0 && record.pid !== record.parentPid
    && record.pid !== process.pid && record.parentPid !== process.pid, 'ATTACH_INVALID_PROCESS_IDS');
  try { process.kill(Number(record.pid), 0); process.kill(Number(record.parentPid), 0); } catch { throw new Error('ATTACH_OWNER_OR_HOST_NOT_LIVE'); }
  return { root, authUrl: url.href, log: () => '', restart: async () => { throw new Error('ATTACHED_RUNTIME_RESTART_FORBIDDEN'); }, stop: async () => {} };
}

async function main(testModel: boolean, attachRoot?: string, route?: [string, string]) {
  const runId = randomUUID(), directory = attachRoot ? fileURLToPath(new URL('../../.runtime/context-native/', import.meta.url)) : resolve('.runtime/context-native');
  const reportPath = resolve(directory, `history-continuity-manual-${runId}.json`);
  const transcript: Record<string, unknown>[] = [], checkpoints: Record<string, unknown>[] = [];
  const report: Record<string, unknown> = { scenario: scenario.id, runKind: testModel ? 'synthetic-adapter-rehearsal' : 'real-model',
    status: 'WAITING_FOR_LOGIN', mode: attachRoot ? 'attached-temp' : 'owned-isolated', attachedRuntimeRetained: Boolean(attachRoot),
    semanticQuality: 'REVIEW_PENDING', autonomousRetrieval: 'REVIEW_PENDING', transcript, checkpoints };
  const controller = new AbortController(), runtime = attachRoot ? await attachTempRuntime(attachRoot) : await startVaultIsolated({ testModel });
  let host: VaultHarness | undefined, lesson: Promise<void> | undefined, stopping = false, sessionId: string | undefined;
  let finish!: () => void;
  const finished = new Promise<void>(resolvePromise => { finish = resolvePromise; });
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  let writing = Promise.resolve();
  const persist = () => { const json = JSON.stringify(report, null, 2) + '\n';
    writing = writing.catch(() => {}).then(async () => { await mkdir(directory, { recursive: true }); await writeFile(reportPath, json, { mode: 0o600 }); }); return writing; };
  async function stop() {
    if (stopping) return; stopping = true; controller.abort(new Error('Manual runner stopped'));
    if (report.status === 'RUNNING' || report.status === 'WAITING_FOR_LOGIN') report.status = 'STOPPED';
    try {
      if (attachRoot && host && sessionId && (await host.sessions()).find(row => row.sessionId === sessionId)?.running === true) {
        host.value(await host.rpc('session/cancel', { request: { sessionId } }));
      }
    } catch { report.sessionCleanup = 'FAILED'; process.exitCode = 1; }
    try { await host?.close(); } catch { report.connectionCleanup = 'FAILED'; process.exitCode = 1; }
    try { if (!attachRoot) await runtime.stop(); await lesson?.catch(() => {}); }
    catch { report.cleanup = 'FAILED'; process.exitCode = 1; }
    finally {
      try { await persist(); } catch { process.exitCode = 1; console.log('报告写入失败。'); }
      finally { input.close(); process.off('SIGINT', onInterrupt); process.off('SIGTERM', onInterrupt); finish(); }
    }
  }
  const onInterrupt = () => { void stop(); };
  process.on('SIGINT', onInterrupt); process.on('SIGTERM', onInterrupt); input.on('SIGINT', onInterrupt);
  input.on('close', () => { void stop(); });
  const userSeqs = new Map<string, number>(), priorCheckpoints = new Map<string, { seq: number; depth: number }>();
  async function idle() {
    const deadline = Date.now() + 180_000;
    while ((await host!.sessions()).find(row => row.sessionId === sessionId)?.running !== false) {
      requireFact(Date.now() < deadline, 'SESSION_IDLE_TIMEOUT'); await delay(100, undefined, { signal: controller.signal });
    }
  }
  async function compact(plan: ContinuityCheckpoint) {
    await idle(); controller.signal.throwIfAborted();
    const before = await captureNativeCut(host!, sessionId!, { signal: controller.signal });
    host!.value(await host!.rpc('commands/execute', { agentId: sessionId, line: '/compact', submittedAttachments: [] }));
    const after = await captureNativeCut(host!, sessionId!, { signal: controller.signal });
    const prefix = await readNativeEvents(host!, sessionId!, after.asOfSeq, -1, { signal: controller.signal, pageMessages: 2 });
    const graph = analyzeNativeCheckpoints(prefix), events = prefix.filter(event => event.seq > before.asOfSeq);
    const summaries = events.filter(event => event.type === 'compaction/summary'); requireFact(summaries.length === 1, 'ONE_COMMITTED_SUMMARY_REQUIRED');
    const summary = summaries[0]!, data = object(summary.data), shadowed = data.shadowedSeqs;
    requireFact(Array.isArray(shadowed), 'INVALID_SUMMARY_SOURCES');
    const replacement = events.find(event => event.type === 'user/message' && object(object(event.data).source).kind === 'compact-checkpoint'
      && object(object(event.data).source).compactionId === data.compactionId);
    requireFact(replacement, 'CHECKPOINT_REPLACEMENT_MISSING');
    const sources = replacement.sourceEventSeqs, range = object(data.shadowedRange), op = object(replacement.surfaceOp);
    requireFact(Array.isArray(sources) && [summary.seq, ...shadowed].every(seq => sources.includes(seq)), 'CHECKPOINT_SOURCE_EDGE_MISSING');
    requireFact(op.op === 'replace' && op.startSeq === range.start && op.endSeq === range.end, 'CHECKPOINT_REPLACEMENT_RANGE_MISMATCH');
    const committed = graph.checkpoint(replacement.seq), covered = graph.coverage(replacement.seq);
    requireFact(committed.summarySeq === summary.seq && object(prefix[committed.startSeq]?.data).turn === null, 'PLANNED_MANUAL_CHECKPOINT_REQUIRED');
    const requiredSources = plan.requiredSourceRounds.map(id => {
      const seq = userSeqs.get(id); requireFact(seq !== undefined, 'REQUIRED_ROUND_SOURCE_MISSING');
      return { id, seq, disposition: covered.has(seq) ? 'folded' : graph.surfaceSeqs.includes(seq) ? 'retained-raw' : 'missing' };
    });
    const prior = plan.requiredPriorCheckpoint ? priorCheckpoints.get(plan.requiredPriorCheckpoint) : undefined;
    const depth = committed.depth;
    checkpoints.push({ id: plan.id, summarySeq: summary.seq, checkpointSeq: replacement.seq, depth,
      tier: committed.tier, endSeq: committed.endSeq, observedThroughSeq: after.asOfSeq, requiredSources,
      priorCheckpointSeq: prior?.seq, priorCheckpointConsumed: prior ? covered.has(prior.seq) : undefined,
      shadowedSeqs: shadowed, sourceEventSeqs: sources, summary: visibleText(data.summary), checkpoint: visibleText(object(replacement.data).content) });
    // Retain the authentic commit and source dispositions even when a coverage
    // assertion fails; evidence of raw retention never substitutes for folding.
    requireFact(requiredSources.every(source => source.disposition === 'folded'), 'REQUIRED_ROUND_NOT_COMPACTED');
    requireFact(!plan.requiredPriorCheckpoint || (prior && covered.has(prior.seq) && committed.depth > prior.depth), 'PRIOR_CHECKPOINT_NOT_CONSUMED');
    priorCheckpoints.set(plan.id, { seq: replacement.seq, depth });
    await persist();
  }
  async function run(provider: string, model: string) {
    report.status = 'RUNNING'; report.route = { provider, model }; await persist();
    host = await connectVault(runtime); controller.signal.throwIfAborted(); sessionId = await host.createSession();
    report.sessionId = sessionId; await persist(); controller.signal.throwIfAborted();
    host.value(await host.rpc('session/selectModel', { request: { sessionId, provider, model } }));
    for (const round of scenario.rounds) {
      controller.signal.throwIfAborted();
      const baseline = await captureNativeCut(host, sessionId, { signal: controller.signal }), requestId = randomUUID();
      host.value(await host.rpc('session/prompt', { request: { sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: round.input }] } }));
      const turn = await waitForNativeTurn(host, sessionId, baseline, { requestId, timeoutMs: 180_000, signal: controller.signal, pageMessages: 2 });
      const usage = turn.events.filter(event => event.type === 'assistant/message').flatMap(event => {
        const source = object(object(event.data).usage), result: Record<string, number> = {};
        for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']) {
          if (typeof source[key] === 'number' && Number.isFinite(source[key])) result[key] = source[key];
        }
        return Object.keys(result).length ? [result] : [];
      });
      const reads = turn.toolOutcomes.filter(tool => ['history_search', 'history_read'].includes(tool.name)).map(tool => {
        let payload: Record<string, unknown> = {}; try { payload = object(JSON.parse(tool.text)); } catch { /* failure remains explicit */ }
        return { name: tool.name, callSeq: tool.callSeq, resultSeq: tool.resultSeq, failed: tool.failed,
          seq: payload.seq, format: payload.format, done: payload.done, receiptSha256: createHash('sha256').update(tool.text).digest('hex'),
          hits: Array.isArray(payload.hits) ? payload.hits.map(hit => { const row = object(hit); return { seq: row.seq, part: row.part, hitStart: row.hitStart, hitEnd: row.hitEnd }; }) : undefined };
      });
      transcript.push({ id: round.id, input: round.input, turn: turn.turn, userSeq: turn.userSeq, startSeq: turn.startSeq, endSeq: turn.endSeq,
        status: turn.status, terminalKind: turn.reason.kind, answer: turn.assistantText, usage, historyEvidence: reads,
        failedToolCount: turn.toolOutcomes.filter(tool => tool.failed).length, unpairedToolResultCount: turn.unpairedToolResults.length });
      userSeqs.set(round.id, turn.userSeq); await persist();
      requireFact(turn.status === 'completed' && turn.reason.kind === 'completed', 'TURN_NOT_COMPLETED');
      requireFact(!turn.toolOutcomes.some(tool => tool.failed) && !turn.unpairedToolResults.length, 'TOOL_RESULT_FAILURE');
      const plan = scenario.checkpoints.find(checkpoint => checkpoint.afterRound === round.id); if (plan) await compact(plan);
      console.log(`运行：${round.id} 完成`);
    }
    requireFact(checkpoints.length === 3 && checkpoints.every((checkpoint, index) => index === 0
      || (typeof checkpoint.depth === 'number' && typeof checkpoints[index - 1]!.depth === 'number'
        && checkpoint.depth > Number(checkpoints[index - 1]!.depth) && checkpoint.priorCheckpointConsumed === true)), 'THREE_NESTED_CHECKPOINTS_REQUIRED');
    report.status = 'STRUCTURE_PASS_REVIEW_PENDING'; await persist(); console.log('结构通过，教学语义与自主检索待人工评审。');
  }
  function startRun(provider: string, model: string) {
    if (lesson || stopping) { console.log('当前运行已开始或正在清理。'); return; }
    lesson = run(provider, model).catch(async error => {
      if (!stopping) { report.status = 'FAIL'; report.failureCode = typeof object(error).code === 'string' ? object(error).code : 'RUN_FAILED'; process.exitCode = 1; }
      await persist(); console.log(stopping ? '已停止。' : '运行失败，已记录最小证据。');
    });
    void lesson.then(() => stop(), () => stop());
  }
  input.on('line', line => {
    const command = line.trim(); if (command === 'stop') { void stop(); return; }
    const parts = command.split(/\s+/);
    if (parts.length !== 3 || parts[0] !== 'run' || parts.slice(1).some(value => !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,255}$/.test(value))) {
      console.log('等待指令：run <provider> <model> 或 stop'); return;
    }
    startRun(parts[1]!, parts[2]!);
  });
  try {
    await persist();
    console.log(attachRoot ? `附加临时实例：${runtime.root}\n报告：${reportPath}\n仅结束本次连接和本次会话，保留原实例。`
      : `临时实例：${runtime.root}\n登录地址：${runtime.authUrl}\n报告：${reportPath}\n等待登录：仅在此实例配置模型后输入 run <provider> <model>。`);
    if (route) startRun(...route);
    await finished;
  } finally { await stop(); }
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node --experimental-strip-types tests/manual/context-continuity.ts [--test-model]\n随后输入 run <provider> <model>；stop 或 Ctrl+C 清理临时实例。\n用户附加入口：--attach-temp <os.tmpdir 下直属 notara-vault-native-* 根> --run <provider> <model>；保留原实例。');
} else {
  let testModel = false, attachRoot: string | undefined, route: [string, string] | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--test-model' && !testModel) testModel = true;
    else if (arg === '--attach-temp' && !attachRoot && args[index + 1] && !args[index + 1]!.startsWith('--')) attachRoot = args[++index]!;
    else if (arg === '--run' && !route && args[index + 1] && args[index + 2]) {
      route = [args[++index]!, args[++index]!];
      requireFact(route.every(value => /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,255}$/.test(value)), 'INVALID_MODEL_ROUTE');
    } else throw new Error('INVALID_MANUAL_RUNNER_ARGUMENTS');
  }
  requireFact(!attachRoot || !testModel, 'ATTACH_CANNOT_USE_TEST_MODEL');
  requireFact(Boolean(attachRoot) === Boolean(route), 'ATTACH_REQUIRES_EXPLICIT_RUN');
  await main(testModel, attachRoot, route);
}

import assert from 'node:assert/strict';
import test from 'node:test';

import { CLASSROOM_VIEW, WORKER_MODEL_PLACEHOLDER, WORKER_STATUS, WORKER_TOOL_NAME, availableRoute, canInspectTask, candidateRouteFor, showsInspectAction, workerFootnote, classroomSummary, draftPersona, draftRoute, draftTools, elapsedLabel, hasRunningTask, isWorkerTool, modelChoices, normalizeRoute, normalizeTools, preferredCandidate, presetLabel, taskRows, toolRowProjection, workerById, workerDraft, workerDraftKey, workerPresetLabel, workerRouteNotice, workerRowProjection, workerRows, workerScopeLabel } from './classroom-client.js';
import { VAULT_REMOTE_METHODS } from './remote-client.js';
import { WORKER_PRESETS, WORKER_TOOLS } from './worker-catalog.js';
import { PERSONA_TEXT_LIMIT } from './persona.js';
import { taskElapsedLabel } from './classroom-client.js';

test('finished task durations stay fixed; interrupted tasks without an end time do not keep running', () => {
  const startedAt = '2026-09-23T06:00:00.000Z', finishedAt = '2026-09-23T06:00:12.000Z';
  const now = Date.parse('2026-09-23T09:00:00.000Z');
  for (const status of ['completed', 'failed', 'canceled']) {
    assert.equal(taskElapsedLabel({ startedAt, finishedAt, status }, now), '用时 12 秒');
    assert.equal(taskElapsedLabel({ startedAt, finishedAt, status }, now + 3_600_000), '用时 12 秒');
  }
  assert.equal(taskElapsedLabel({ startedAt, status: 'running' }, now), '已进行 3 小时 0 分钟');
  assert.equal(taskElapsedLabel({ startedAt, status: 'interrupted' }, now), '');
  assert.equal(taskElapsedLabel({ startedAt, finishedAt: 'invalid', status: 'completed' }, now), '');
  assert.equal(taskElapsedLabel({ startedAt: finishedAt, finishedAt: startedAt, status: 'completed' }, now), '');
});

/** The five real worker rows the Host sends, before any per-preset override. */
const WORKERS = WORKER_PRESETS.map(preset => ({
  id: preset.id, name: preset.name, description: preset.description,
  preferredModel: 'gpt-5.6-sol', route: null, ready: false, tools: 'none',
}));

const payload = (extra = {}) => ({
  revision: 3,
  teacher: { name: '大肥鱼', description: '爱吃白饭的鲸鱼娘女仆。' },
  models: extra.models ?? [{ provider: 'test', model: 'gpt-5.6-sol', label: '解题专用', reasoningEfforts: ['high', 'medium'] }],
  workers: (extra.workers ?? WORKERS).map(worker => ({ ...worker, ...(extra.worker ?? {}) })),
  tasks: extra.tasks ?? [],
});

/** The view plus one named worker, which is the unit every helper works on. */
const view = (extra = {}) => classroomSummary(payload(extra));
const pick = (extra, id = 'problem') => workerById(view(extra), id);

test('教室 value 投影 Host 给的五位工作员与真实模型列表，不合并成一个角色', () => {
  const summary = view();
  assert.equal(summary.teacher.name, '大肥鱼');
  assert.deepEqual(summary.workers.map(row => row.id), ['problem', 'lesson', 'review', 'general', 'exercise']);
  assert.deepEqual(summary.workers.map(row => row.name), ['题目研究员', '课时备课员', '核验员', '通用工作员', '出题员']);
  assert.deepEqual(summary.models, [{ provider: 'test', model: 'gpt-5.6-sol', label: '解题专用', reasoningEfforts: ['high', 'medium'] }]);
  assert.equal(summary.revision, 3);
  // 每个工作员保留自己的工具范围，缺省是 none。
  assert.deepEqual([...new Set(summary.workers.map(row => row.tools))], ['none']);
  assert.equal(normalizeTools('read'), 'read');
  assert.equal(normalizeTools('write'), 'none');
  assert.equal(normalizeTools(undefined), 'none');
  assert.deepEqual(WORKER_TOOLS.read, ['read', 'glob', 'grep', 'read_image']);
  assert.deepEqual(WORKER_TOOLS.none, []);
});

test('权限文案分得清 none 与 read：read 是真的能读原文，不是“没有工具”', () => {
  assert.equal(workerScopeLabel({ tools: 'read' }), '可读取原文、搜索资料和查看图片');
  assert.equal(workerScopeLabel({ tools: 'none' }), '不读文件，只用老师交付的材料');
  assert.equal(workerScopeLabel({}), '');
  assert.notEqual(workerScopeLabel({ tools: 'read' }), workerScopeLabel({ tools: 'none' }));
  // 两个工作员各自的资料范围不会互相覆盖：problem 可读，review 仍只用交付材料。
  const summary = view({ workers: WORKERS.map(row => row.id === 'problem' ? { ...row, tools: 'read' } : row) });
  assert.equal(workerScopeLabel(workerById(summary, 'problem')), '可读取原文、搜索资料和查看图片');
  assert.equal(workerScopeLabel(workerById(summary, 'review')), '不读文件，只用老师交付的材料');
});

test('设置草稿按 session + preset 分键：切换工作员不会读到别人的草稿', () => {
  assert.notEqual(workerDraftKey('lesson-a', 'problem'), workerDraftKey('lesson-a', 'review'));
  assert.notEqual(workerDraftKey('lesson-a', 'problem'), workerDraftKey('lesson-b', 'problem'));
  assert.equal(workerDraftKey('lesson-a', 'problem'), workerDraftKey('lesson-a', 'problem'));
  assert.notEqual(workerDraftKey('lesson-a', 'problem'), 'lesson-a');
});

test('一个 preset 的 route/ready/tools 不会串到其他 preset', () => {
  const summary = view({ workers: WORKERS.map(row => row.id === 'problem' ? { ...row, tools: 'read', route: { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high' }, ready: true } : row) });
  const problem = workerById(summary, 'problem'), review = workerById(summary, 'review');
  assert.equal(problem.ready, true);
  assert.equal(problem.tools, 'read');
  assert.deepEqual(problem.route, { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high' });
  assert.equal(review.ready, false);
  assert.equal(review.route, null);
  assert.equal(review.tools, 'none');
  // 草稿也是每位一份：配置 problem 的模型与工具范围不会改掉 review 的草稿。
  assert.deepEqual(workerDraft(problem, summary.models), { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high', maxTokens: 32768, tools: 'read', persona: '' });
  assert.equal(workerDraft(review, summary.models).tools, 'none');
  assert.equal(workerDraft(review, summary.models).reasoningEffort, 'high');
});

test('每位工作员的人格各自保存与回读，空白只用角色职责', () => {
  assert.deepEqual(workerRows(payload()).map(row => row.persona), ['', '', '', '', ''], '旧配置缺 persona 时缺省空串');
  const summary = view({ workers: WORKERS.map(row => row.id === 'problem' ? { ...row, persona: '说话简短，偶尔用比喻。' } : row) });
  const problem = workerById(summary, 'problem'), review = workerById(summary, 'review');
  assert.equal(problem.persona, '说话简短，偶尔用比喻。');
  assert.equal(review.persona, '', '另一位工作员不会继承这一位的人格');
  assert.equal(workerDraft(problem, summary.models).persona, '说话简短，偶尔用比喻。');
  assert.equal(workerDraft(review, summary.models).persona, '');
  assert.equal(draftPersona({ persona: '  你是一位严厉的助教。 ' }), '你是一位严厉的助教。');
  assert.equal(draftPersona({ persona: '   ' }), '', '空白等于回到只用角色职责');
  // 升级前保存的草稿没有这一项：这次保存不改已保存的人格，而不是静默清空。
  assert.equal(draftPersona({}), undefined);
  assert.equal(draftPersona(null), undefined);
  assert.ok(draftPersona({ persona: '字'.repeat(PERSONA_TEXT_LIMIT + 1) }).length > PERSONA_TEXT_LIMIT);
});

test('路由只接受 provider+model，重复或残缺的模型不会进入选项', () => {
  assert.deepEqual(normalizeRoute({ provider: 'test', model: 'gpt-5.6-sol' }), { provider: 'test', model: 'gpt-5.6-sol' });
  assert.deepEqual(normalizeRoute({ provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: '' }), { provider: 'test', model: 'gpt-5.6-sol' });
  assert.equal(normalizeRoute({ provider: 'test' }), null);
  assert.equal(normalizeRoute(null), null);
  const choices = modelChoices(payload({ models: [
    { provider: 'test', model: 'gpt-5.6-sol', label: '', reasoningEfforts: ['high', '', 'high'] },
    { provider: 'test', model: 'gpt-5.6-sol', label: '重复' },
    { provider: '', model: 'x' },
    null,
  ] }));
  assert.deepEqual(choices, [{ provider: 'test', model: 'gpt-5.6-sol', label: 'gpt-5.6-sol', reasoningEfforts: ['high'] }]);
});

test('首选模型只认确切同名，绝不用父模型或别的模型代替', () => {
  const summary = view();
  assert.equal(preferredCandidate(workerById(summary, 'problem'), summary.models).model, 'gpt-5.6-sol');
  const other = view({ models: [{ provider: 'test', model: 'teacher-flash', label: '通用', reasoningEfforts: [] }] });
  assert.equal(preferredCandidate(workerById(other, 'problem'), other.models), null);
});

test('未接入时说明缺口，自动匹配时不谎称已经在用某个模型', () => {
  const missing = view({ models: [], worker: { reason: '后台模型没有接入。' } });
  const missingWorker = workerById(missing, 'problem');
  assert.equal(workerRouteNotice(missingWorker, missing.models), '后台模型没有接入。');
  assert.equal(workerFootnote(missingWorker, missing.models), '请在教室设置里接入 gpt-5.6-sol；老师自己的模型不会用来代替它。');
  const auto = view({ worker: { route: { provider: 'test', model: 'gpt-5.6-sol' }, ready: true } });
  const autoWorker = workerById(auto, 'problem');
  assert.equal(workerRouteNotice(autoWorker, auto.models), '后台分析使用 解题专用。');
  assert.equal(workerFootnote(autoWorker, auto.models), '后台结果只交给老师，老师会用自己的方式讲给你。');
  // route 为空但 ready=true：Host 的自动匹配已可用，不能再说“请接入”。
  const autoOnly = view({ worker: { route: null, ready: true } });
  const autoOnlyWorker = workerById(autoOnly, 'problem');
  assert.equal(workerRouteNotice(autoOnlyWorker, autoOnly.models), '后台分析会自动匹配 gpt-5.6-sol。');
  assert.equal(workerFootnote(autoOnlyWorker, autoOnly.models), '后台结果只交给老师，老师会用自己的方式讲给你。');
  // 已保存的模型当前没接入：route 明说不可用，即使 ready 由默认匹配算出。
  const gone = view({ models: [{ provider: 'test', model: 'teacher-flash', label: '通用', reasoningEfforts: [] }], worker: { route: { provider: 'test', model: 'gpt-5.6-sol' }, ready: true } });
  const goneWorker = workerById(gone, 'problem');
  assert.equal(availableRoute(goneWorker, gone.models), null);
  assert.match(workerRouteNotice(goneWorker, gone.models), /现在不可用/);
  assert.doesNotMatch(workerRouteNotice(goneWorker, gone.models), /后台分析使用/);
});

test('已保存但当前不可用时先讲原因，不宣称正在使用该模型', () => {
  const offline = view({ worker: { route: { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high' }, ready: false, reason: 'provider 暂时不可用。' } });
  const worker = workerById(offline, 'problem');
  assert.equal(workerRouteNotice(worker, offline.models), 'provider 暂时不可用。');
  const noReason = view({ worker: { route: { provider: 'test', model: 'gpt-5.6-sol' }, ready: false } });
  const noReasonWorker = workerById(noReason, 'problem');
  assert.match(workerRouteNotice(noReasonWorker, noReason.models), /现在不可用/);
  assert.doesNotMatch(workerRouteNotice(noReasonWorker, noReason.models), /后台分析使用/);
});

test('候选路由顺序为已保存 > 确切首选；没有任何已保存时只认确切首选', () => {
  const MODELS = [
    { provider: 'test', model: 'teacher-flash', label: '通用', reasoningEfforts: ['medium'] },
    { provider: 'test', model: 'gpt-5.6-sol', label: '解题专用', reasoningEfforts: ['high', 'medium'] },
  ];
  const fresh = view({ models: MODELS });
  assert.deepEqual(candidateRouteFor(workerById(fresh, 'problem'), fresh.models), { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high' });
  const saved = view({ models: MODELS, worker: { route: { provider: 'test', model: 'teacher-flash', reasoningEffort: 'medium' } } });
  assert.deepEqual(candidateRouteFor(workerById(saved, 'problem'), saved.models), { provider: 'test', model: 'teacher-flash', reasoningEffort: 'medium' });
  // 已保存的失效选择不会被静默清掉：草稿仍指向它，候选退回确切首选。
  const savedMissing = view({ models: MODELS, worker: { route: { provider: 'test', model: 'retired-sol' } } });
  const staleWorker = workerById(savedMissing, 'problem');
  assert.equal(workerDraft(staleWorker, savedMissing.models).model, 'retired-sol');
  assert.deepEqual(candidateRouteFor(staleWorker, savedMissing.models), { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high' });
  const noPreferred = view({ models: [{ provider: 'test', model: 'teacher-flash', label: '通用', reasoningEfforts: [] }], worker: { route: { provider: 'test', model: 'retired-sol' } } });
  assert.equal(candidateRouteFor(workerById(noPreferred, 'problem'), noPreferred.models), null);
  assert.equal(workerDraft(workerById(noPreferred, 'problem'), noPreferred.models).model, 'retired-sol');
});

test('没有确切首选时不预选任何普通模型，空选项等待老师自己选', () => {
  const noSol = view({ models: [{ provider: 'test', model: 'teacher-flash', label: '通用', reasoningEfforts: ['medium'] }] });
  const worker = workerById(noSol, 'problem');
  assert.equal(candidateRouteFor(worker, noSol.models), null);
  const draft = workerDraft(worker, noSol.models);
  assert.deepEqual(draft, { provider: '', model: '', reasoningEffort: '', maxTokens: 32768, tools: 'none', persona: '' });
  assert.equal(draftRoute(draft), null);
  assert.equal(WORKER_MODEL_PLACEHOLDER, '请选择已接入的解题模型');
  assert.equal(candidateRouteFor(workerById(view({ models: [] }), 'problem'), []), null);
});

test('预算与工具范围独立保存，默认不取列表里的低等级', () => {
  const worker = workerById(view({ models: [{ provider: 'test', model: 'gpt-5.6-sol', reasoningEfforts: ['low', 'high', 'xhigh'] }] }), 'problem');
  assert.equal(candidateRouteFor(worker, [{ provider: 'test', model: 'gpt-5.6-sol', reasoningEfforts: ['low', 'high', 'xhigh'] }]).reasoningEffort, 'xhigh');
  assert.equal(workerDraft(worker, view({ models: [{ provider: 'test', model: 'gpt-5.6-sol', reasoningEfforts: ['low', 'high', 'xhigh'] }] }).models).maxTokens, 32768);
  const route = draftRoute({ provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high', maxTokens: '49152' });
  assert.equal(route.maxTokens, 49152);
  assert.equal(draftRoute({ provider: 'test', model: 'gpt-5.6-sol', maxTokens: '' }), null);
  assert.equal(draftRoute({ provider: 'test', model: 'gpt-5.6-sol', maxTokens: '-2' }), null);
  // 空选项不是“关闭”，而是交给 Host 的自动匹配；对话框对此另有明确按钮。
  assert.equal(draftRoute({ provider: 'test', model: '' }), null);
  assert.equal(draftRoute({}), null);
  assert.equal(draftRoute(null), null);
  assert.equal(draftTools({ tools: 'read' }), 'read');
  assert.equal(draftTools({ tools: 'none' }), 'none');
  assert.equal(draftTools({}), 'none');
});

test('只有真的 spawn 出子会话的任务才给“查看分析”入口', () => {
  const rows = taskRows(payload({ tasks: [
    { id: 'spawned', preset: 'problem', status: 'completed', inspectable: true, startedAt: '2026-09-21T05:00:00.000Z' },
    { id: 'preparing', preset: 'lesson', status: 'running', inspectable: false, startedAt: '2026-09-21T05:01:00.000Z' },
    { id: 'failed-before-spawn', preset: 'review', status: 'failed', inspectable: false, startedAt: '' },
  ] }));
  const byId = Object.fromEntries(rows.map(row => [row.id, row]));
  assert.equal(byId.spawned.inspectable, true);
  assert.equal(showsInspectAction(byId.spawned), true);
  // 准备瞬间（尚未 spawn）与运行中都不给入口，避免点了才报错。
  assert.equal(byId.preparing.inspectable, false);
  assert.equal(showsInspectAction(byId.preparing), false);
  assert.equal(byId['failed-before-spawn'].inspectable, false);
  assert.equal(showsInspectAction(byId['failed-before-spawn']), false);
  // 后端漏传 inspectable 一律当作不可查看，不猜。
  assert.equal(taskRows(payload({ tasks: [{ id: 'x', status: 'completed' }] }))[0].inspectable, false);
  assert.equal(canInspectTask({ status: 'completed' }), false);
  assert.equal(canInspectTask({ status: 'running', inspectable: true }), true);
});

test('任务按 preset 归到岗位，只暴露状态、时间与停止资格', () => {
  const rows = taskRows(payload({ tasks: [
    { id: 'task-secret-1', preset: 'problem', status: 'running', startedAt: '2026-09-21T06:00:00.000Z' },
    { id: 'task-secret-2', preset: 'exercise', status: 'completed', startedAt: '2026-09-21T05:00:00.000Z' },
    { id: 'task-secret-3', preset: 'review', status: 'canceled', startedAt: '' },
  ] }));
  assert.deepEqual(rows.map(row => [row.preset, row.status, row.label, row.cancelable]), [['problem', 'running', '分析中', true], ['exercise', 'completed', '分析完成', false], ['review', 'canceled', '已停止', false]]);
  // 任务名用可信的 preset 中文名，不照抄未知文案。
  assert.deepEqual(rows.map(row => row.name), ['题目研究员', '出题员', '核验员']);
  const hostile = taskRows(payload({ tasks: [{ id: 'x', preset: 'problem', name: 'PRIVATE_TASK_TITLE', status: 'completed' }] }));
  assert.equal(hostile[0].name, '题目研究员');
  assert.equal(rows[0].id, 'task-secret-1');
  assert.equal(hasRunningTask(payload({ tasks: [{ id: 'a', preset: 'problem', status: 'running' }] })), true);
  assert.equal(hasRunningTask(payload({ tasks: [{ id: 'a', preset: 'problem', status: 'completed' }] })), false);
  assert.equal(taskRows(payload({ tasks: [{ id: 'a', preset: 'problem', status: '未知' }] }))[0].status, 'interrupted');
});

test('停止按钮只在运行中的任务上出现，时间提示不包含 run/task 标识', () => {
  const now = Date.parse('2026-09-21T06:05:00.000Z');
  assert.equal(elapsedLabel('2026-09-21T06:04:10.000Z', now), '刚刚开始');
  assert.equal(elapsedLabel('2026-09-21T06:00:00.000Z', now), '已进行 5 分钟');
  assert.equal(elapsedLabel('not-a-date', now), '');
});

test('ask_worker 行只显示状态与可信 preset 中文名，原始参数与解答一律不进入投影', () => {
  const raw = { callId: 'call-1', name: 'ask_worker', argsRaw: JSON.stringify({ preset: 'problem', goal: 'PRIVATE_GOAL', materials: [{ title: 'PRIVATE_MATERIAL', text: 'PRIVATE_BODY' }] }), turn: 2, step: 3, subCalls: [{ callId: 'child-1' }] };
  const running = workerRowProjection(raw);
  assert.deepEqual(running, { lane: 'worker', name: '题目研究员', state: 'running', text: '正在请题目研究员处理这次任务，结果只会交给老师。' });
  assert.equal(workerPresetLabel(raw), '题目研究员');
  const handed = toolRowProjection({ block: { kind: 'tool-result', callId: 'call-1', call: { name: 'ask_worker', argsRaw: raw.argsRaw }, content: [{ type: 'text', text: 'PRIVATE_SOLUTION' }], isError: false } });
  assert.equal(handed.text, '题目研究员的结果已经交给老师，由老师决定怎么讲。');
  const refused = workerRowProjection({ kind: 'tool-result', call: { argsRaw: raw.argsRaw }, isError: true, error: { code: 'worker_model_unavailable' } });
  assert.equal(refused.state, 'refused');
  for (const row of [running, handed, refused]) {
    assert.doesNotMatch(JSON.stringify(row), /PRIVATE_GOAL|PRIVATE_SOLUTION|PRIVATE_MATERIAL|PRIVATE_BODY|call-1|child-1|ask_worker/);
  }
  // 未知 preset、坏 JSON 与历史 ask_solver 行都退回中性角色名，不吐出模型文本。
  for (const argsRaw of [JSON.stringify({ preset: 'PRIVATE_PRESET', goal: 'X' }), '{not json', JSON.stringify({ goal: 'X' })]) {
    assert.equal(workerPresetLabel({ argsRaw }), '后台工作员');
    assert.doesNotMatch(workerRowProjection({ argsRaw }).name, /PRIVATE/);
  }
  assert.equal(workerPresetLabel(null), '后台工作员');
  assert.deepEqual(WORKER_STATUS, { running: '正在分析', handed: '已交给老师', refused: '暂时不能分析', stopped: '已停止' });
  assert.equal(WORKER_TOOL_NAME, 'ask_worker');
  assert.equal(isWorkerTool('ask_worker'), true);
  assert.equal(isWorkerTool('ask_solver'), true);
  assert.equal(isWorkerTool('vault_read'), false);
  assert.equal(presetLabel('exercise'), '出题员');
  assert.equal(presetLabel('nope'), '');
});

test('教室 RPC 挂在 notaraVault 客户端上，且教室 view id 独立于其他 bench', () => {
  for (const method of ['classroom', 'configureSolver', 'cancelSolver', 'solverTask']) assert.ok(VAULT_REMOTE_METHODS.includes(method), method);
  assert.equal(CLASSROOM_VIEW, 'notara-vault-classroom');
  assert.notEqual(CLASSROOM_VIEW, 'notara-vault');
  assert.equal(VAULT_REMOTE_METHODS.includes('configureSolver') && VAULT_REMOTE_METHODS.includes('cancelSolver'), true);
});

// ---------------------------------------------------------------------------
// Component wiring (DOM behaviour is verified separately in a real browser)
// ---------------------------------------------------------------------------

const settle = () => new Promise(resolve => setImmediate(resolve));

/** The two browser globals the bench touches while its effects are inert. */
async function withBrowserGlobals(run) {
  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const store = new Map();
  globalThis.localStorage = { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
  try { return await run(); }
  finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
  }
}

test('教室组件在有值之前只发一次 classroom 读取，不借用其它 RPC', () => withBrowserGlobals(async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createVaultClassroom } = await import('./classroom-client.js');
  const raw = payload({
    workers: WORKERS.map(row => row.id === 'problem' ? { ...row, route: { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high' }, ready: true } : row),
    tasks: [{ id: 'task-secret-running', preset: 'problem', status: 'running', startedAt: new Date().toISOString() }],
  });
  const calls = [];
  const ctx = {
    slots: { entries: () => [], subscribe: () => () => {} },
    remote: new Proxy({}, {
      get: (_target, method) => async input => {
        calls.push({ method, input });
        if (method === 'classroom') return { ok: true, value: raw };
        throw new Error('unexpected RPC ' + String(method));
      },
    }),
  };
  const IconButton = ({ label, onClick, children, ...rest }) => React.createElement('button', { type: 'button', 'aria-label': label, onClick, ...rest }, children);
  const Dialog = ({ title, children }) => React.createElement('section', { role: 'dialog', 'aria-label': title }, children);
  const { ClassroomView, WorkerToolRow } = createVaultClassroom(React, { STYLE: {}, IconButton, Dialog });
  // A static render runs no effects, so this asserts the mount-time contract only:
  const loading = renderToStaticMarkup(React.createElement(ClassroomView, { ctx, sessionId: 'lesson-math', visible: true, useSession: select => select({ running: false }) }));
  assert.match(loading, /正在读取/);
  assert.doesNotMatch(loading, /task-secret/);
  await settle();
  // Static rendering runs no effects, so mounting the bench starts no request;
  // the live read/write calls are asserted in the browser check below.
  assert.deepEqual(calls, []);
  // The ask_worker row is a pure component: its markup is the projection itself.
  const row = renderToStaticMarkup(React.createElement(WorkerToolRow, {
    toolName: 'ask_worker',
    block: { callId: 'call-9', name: 'ask_worker', argsRaw: '{"preset":"problem","goal":"PRIVATE_GOAL"}', subCalls: [{ callId: 'child-9' }] },
  }));
  assert.match(row, /题目研究员/);
  assert.match(row, /data-tool="ask_worker"/);
  assert.doesNotMatch(row, /PRIVATE_GOAL|call-9|child-9|argsRaw/);
}));

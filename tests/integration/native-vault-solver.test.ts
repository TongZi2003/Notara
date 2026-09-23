/**
 * Native Vault classroom solver acceptance over the real HTTP Host — no browser.
 *
 * The classroom, the fixed teacher persona, the fixed solver task, the native
 * child session, its tool surface and the file facts are all produced by the
 * isolated runtime this repository ships (`startVaultIsolated`): a temp DSH_HOME
 * plus a temp classroom, the real DSH Host, the plugin's own preset and the real
 * `ctx.subagents` spawn provider. The model backend is substituted by a
 * scripted LlmAdapter that records the request it actually received, so "the
 * solver ran on this model", "the child had no tools" and "the parent's private
 * turn did not reach the child" are read from the assembled request instead of
 * asserted in prose.
 *
 * What this file owns: the RPC contract of `notaraVault/classroom`,
 * `configureSolver` and `cancelSolver`, the `ask_worker` teacher tool and the
 * non-UI runtime boundary of the classroom solver. The learner-facing bench
 * (tab, roles, configuration dialog, status, stop control) is validated in the
 * Playwright lane; this file never claims UI behaviour.
 */
import { afterEach, expect, test } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { blocks, connectVault, effectiveSystemText, outcomeJson, toolNames, toolResultTexts, type AssembledRequest, type VaultHarness } from '../fixtures/vault-http.ts';
import {
  VAULT_SOLVER_AMBIGUOUS_ENV, VAULT_SOLVER_AMBIGUOUS_PROVIDER, VAULT_SOLVER_MODEL, VAULT_SOLVER_PROVIDER, VAULT_SOLVER_REPLY_KEY,
  VAULT_TEST_MODEL, VAULT_TEST_PROVIDER,
} from '../../scripts/fixtures/vault-test-model.ts';

interface SolverRoute { provider: string; model: string; reasoningEffort?: string | null; maxTokens?: number }
interface SolverView { name: string; description: string; preferredModel: string; route: SolverRoute | null; ready: boolean; reason?: string }
interface ModelRow { provider: string; model: string; label: string; reasoningEfforts: string[] }
interface TaskRow { id: string; status: string; startedAt?: string; finishedAt?: string; inspectable?: boolean }
interface ClassroomView { revision: number; teacher: { name: string; description: string }; workers: (SolverView & {id: string; tools: string})[]; models: ModelRow[]; tasks: TaskRow[] }
interface SessionRowWithParent { sessionId: string; running?: boolean; origin?: string; parentSessionId?: string }
interface SolverOutcome { taskId?: string; status?: string; analysis?: string }
/** The Host's own parent/child binding for one solver task (查看分析). */
interface SolverTaskBinding { parentSessionId: string; childSessionId: string; mode: 'one-shot'; status: string }

/** The fixed teacher the classroom always reports, as the product names it. */
const TEACHER_NAME = '大肥鱼';
/** Marker that exists only in the parent teacher turn, never in the child. */
const PARENT_ONLY_MARKER = '老师私下备注 XK-7719';
/** Marker that exists only in the synthetic solver's answer. */
const ANALYSIS_MARKER = 'SOLVER-ANALYSIS-Q7';

let runtime: VaultRuntime | undefined;
let harness: VaultHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await runtime?.stop();
  runtime = undefined;
});

async function classroomOf(client: VaultHarness, sessionId: string): Promise<ClassroomView> {
  return client.value(await client.rpc<ClassroomView>('notaraVault/classroom', { input: { sessionId } }));
}
/** Configure returns whatever it returns; the projection below is the contract. */
async function configure(client: VaultHarness, sessionId: string, expectedRevision: number, route: SolverRoute | null): Promise<void> {
  client.value(await client.rpc('notaraVault/configureSolver', { input: { sessionId, expectedRevision, route, preset: 'problem', tools: 'none' } }));
}
async function cancel(client: VaultHarness, sessionId: string, taskId: string): Promise<void> {
  client.value(await client.rpc('notaraVault/cancelSolver', { input: { sessionId, taskId } }));
}
/** Write the run's own scripted replies, including fields the harness type omits. */
async function script(client: VaultHarness, replies: Record<string, unknown>): Promise<void> {
  await writeFile(join(client.root, 'teacher-replies.json'), `${JSON.stringify(replies, null, 2)}\n`);
}
async function childSessions(client: VaultHarness, sessionId: string): Promise<SessionRowWithParent[]> {
  const rows = await client.sessions() as unknown as SessionRowWithParent[];
  return rows.filter(row => row.parentSessionId === sessionId && row.origin === 'subagent');
}
function isSolverRoute(request: AssembledRequest): boolean {
  return request.provider === VAULT_SOLVER_PROVIDER || request.provider === VAULT_SOLVER_AMBIGUOUS_PROVIDER;
}
function reasoningEffortOf(request: AssembledRequest): string | null {
  const value = (request as unknown as { reasoningEffort?: string | null }).reasoningEffort;
  return typeof value === 'string' ? value : null;
}
function unexpectedKeys(value: object, allowed: readonly string[]): string[] {
  return Object.keys(value).filter(key => !allowed.includes(key));
}

test('五预设真实请求使用独立人格与配置；只读工作员能读资料但不能写入或继续派工', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  await harness.writeVaultFile('worker-evidence.md', 'WORKER_READ_EVIDENCE');
  const initial = await classroomOf(harness, session);
  harness.value(await harness.rpc('notaraVault/configureSolver', { input: { sessionId: session, expectedRevision: initial.revision, preset: 'general', tools: 'read', route: { provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL, reasoningEffort: 'low', maxTokens: 8192 } } }));
  const names = { problem: '题目研究员', lesson: '课时备课员', review: '核验员', general: '通用工作员', exercise: '出题员' };
  const replies: Record<string, unknown> = {
    '私密背景': 'PARENT_ONLY_BACKGROUND',
    '__worker:general': { calls: [
      { name: 'read', arguments: { file_path: join(harness.vault, 'worker-evidence.md') } },
      { name: 'write', arguments: { file_path: join(harness.vault, 'should-not-exist.md'), content: 'UNAUTHORIZED' } },
      { name: 'ask_worker', arguments: { preset: 'general', goal: '禁止递归' } },
    ], text: 'GENERAL_ARTIFACT' },
  };
  for (const preset of Object.keys(names)) {
    replies[`运行${preset}`] = [{ name: 'ask_worker', arguments: { preset, goal: `完成${preset}限定工作`, materials: [{ title: '待核对证据', text: 'EXPLICIT_ONLY_EVIDENCE：待核对，不是勘误结论。' }], ...(preset === 'exercise' ? { skills: ['notara-subject-math'] } : {}) } }];
    if (preset !== 'general') replies[`__worker:${preset}`] = `${preset.toUpperCase()}_ARTIFACT`;
  }
  await script(harness, replies);
  await harness.ask(session, '私密背景');
  for (const preset of Object.keys(names)) await harness.ask(session, `运行${preset}`);
  const outcomes = (await harness.outcomes(session)).filter(row => row.name === 'ask_worker');
  expect(outcomes).toHaveLength(5);
  expect(outcomes.every(row => !row.failed), outcomes.map(row => row.text).join('\n')).toBe(true);
  const requests = (await harness.requests()).filter(row => isSolverRoute(row) && !row.purpose);
  const childIds = [...new Set(requests.map(row => row.sessionId))];
  expect(childIds).toHaveLength(5);
  for (const preset of Object.keys(names)) {
    const group = requests.filter(row => row.messages.some(message => message.role === 'user' && message.content.some(block => block.text?.includes(`完成${preset}限定工作`))));
    expect(group.length, preset).toBeGreaterThan(0);
    const system = effectiveSystemText(group[0]!);
    expect(system).toContain(`# ${names[preset as keyof typeof names]}`);
    expect(system).not.toContain('你是教学者');
    expect(JSON.stringify(group)).not.toContain('PARENT_ONLY_BACKGROUND');
    expect(system.includes('notara-subject-math')).toBe(preset === 'exercise');
    expect(toolNames(group[0]!).sort()).toEqual(preset === 'general' ? ['glob', 'grep', 'read', 'read_image'] : []);
    if (preset === 'general') {
      const result = blocks(group.at(-1)!).filter(block => block.type === 'tool-result');
      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ isError: false });
      expect(JSON.stringify(result[0])).toContain('WORKER_READ_EVIDENCE');
      expect(result[1]).toMatchObject({ isError: true });
      expect(result[2]).toMatchObject({ isError: true });
      expect(reasoningEffortOf(group[0]!)).toBe('low');
    }
  }
  expect(await harness.vaultExists('should-not-exist.md')).toBe(false);
  const projection = await classroomOf(harness, session);
  expect(projection.tasks).toHaveLength(5);
  expect(JSON.stringify(projection)).not.toMatch(/ARTIFACT|EXPLICIT_ONLY|WORKER_READ_EVIDENCE/);
}, 300_000);

test('六科与旧领域关注只进入显式选择的知识工作员请求', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  harness.value(await harness.rpc('notaraVault/updateTeachingSettings', {
    input: { sessionId: session, expectedRevision: 0, patch: { subjects: ['语文', '物理'] } },
  }));
  const subjects = ['math', 'physics', 'chemistry', 'computing', 'chinese', 'english', 'science', 'humanities'];
  const bodies = await Promise.all(subjects.map(id => readFile(new URL(`../../resources/vault-teaching/skills/subject-${id}.md`, import.meta.url), 'utf8')));
  const replies: Record<string, unknown> = { '先记住课堂背景': 'PARENT_SUBJECT_PRIVATE', '__worker:general': 'KNOWLEDGE_UNIT_ARTIFACT' };
  for (const id of subjects) {
    replies[`研究${id}单元`] = [{ name: 'ask_worker', arguments: {
      preset: 'general', goal: `研究${id}限定知识单元`, skills: [`notara-subject-${id}`],
      materials: [{ title: '本次原文', text: `EXPLICIT_UNIT_${id}` }],
    } }];
  }
  await script(harness, replies);
  await harness.ask(session, '先记住课堂背景');
  for (const id of subjects) await harness.ask(session, `研究${id}单元`);
  const outcomes = (await harness.outcomes(session)).filter(row => row.name === 'ask_worker');
  expect(outcomes).toHaveLength(subjects.length);
  expect(outcomes.every(row => !row.failed), outcomes.map(row => row.text).join('\n')).toBe(true);
  const requests = (await harness.requests()).filter(row => !row.purpose);
  const children = requests.filter(isSolverRoute);
  expect(new Set(children.map(row => row.sessionId)).size).toBe(subjects.length);
  for (const [index, id] of subjects.entries()) {
    const child = children.find(row => row.messages.some(message => message.role === 'user' && message.content.some(block => block.text?.includes(`研究${id}限定知识单元`))));
    expect(child, id).toBeDefined();
    const system = effectiveSystemText(child!);
    expect(system).toContain(bodies[index]!.trim());
    for (const [other, body] of bodies.entries()) if (other !== index) expect(system).not.toContain(body.trim());
    expect(JSON.stringify(child)).toContain(`EXPLICIT_UNIT_${id}`);
    expect(JSON.stringify(child)).not.toContain('PARENT_SUBJECT_PRIVATE');
    expect(toolNames(child!)).toEqual([]);
  }
  const firstTeacher = requests.find(row => row.sessionId === session)!;
  expect(firstTeacher).toBeDefined();
  for (const body of bodies) expect(effectiveSystemText(firstTeacher)).not.toContain(body.trim());
  expect(JSON.stringify(await classroomOf(harness, session))).not.toMatch(/KNOWLEDGE_UNIT_ARTIFACT|EXPLICIT_UNIT_/);
}, 300_000);

test('原生参数解析失败能定位JSON错误，修正后只启动一个独立draft任务', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  const draft = '---\ntags: [三角形]\n---\n## 内容\n核对"CD=CE"这一步。\n\n## 参考理解\n需要原图确定切点。\n\n## 学生理解\n';
  await script(harness, {
    '把这一题整理成卡片草稿。': [
      { name: 'ask_worker', rawArguments: '{"preset":"problem","goal":"核对"CD=CE"这一步"}' },
      { name: 'ask_worker', arguments: { preset: 'problem', goal: '核对"CD=CE"这一步', materials: [{ title: '原题', text: '图像尚未给出，不猜切点。' }] } },
    ],
    [VAULT_SOLVER_REPLY_KEY]: draft,
  });
  const turns = await harness.ask(session, '把这一题整理成卡片草稿。');
  const outcomes = (await harness.outcomes(session)).filter(row => row.name === 'ask_worker');
  expect(outcomes).toHaveLength(2);
  expect(outcomes[0]?.failed).toBe(true);
  expect(outcomes[0]?.text).toMatch(/solver_input_invalid: arguments.*JSON.*转义/);
  expect(outcomes[1]?.failed).toBe(false);
  expect(outcomeJson<SolverOutcome>(outcomes[1]!)?.analysis).toBe(draft.trim());
  const children = await childSessions(harness, session);
  expect(children).toHaveLength(1);
  const childRequest = (await harness.requests()).find(row => row.sessionId === children[0]!.sessionId)!;
  expect(childRequest.toolSchemas).toEqual([]);
  expect(childRequest.messages.flatMap(row => row.content).some(block => {
    if (block.type !== 'text') return false;
    try { return JSON.parse(block.text ?? '').preset === 'problem'; } catch { return false; }
  })).toBe(true);
  expect(toolResultTexts(turns.at(-1)!).join('\n')).toContain('学生理解');
  expect((await classroomOf(harness, session)).tasks).toHaveLength(1);
}, 300_000);

test('解题请求实际收到原页图像与独立预算；原文件变更后拒绝旧引用', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  const pdfPath = join(harness.vault, '媒体/向量讲义.pdf');
  const bytes = await readFile(pdfPath);
  const revision = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const source = `![[媒体/向量讲义.pdf#page=1&revision=${revision}]]`;
  const request = { name: 'ask_worker', arguments: { preset: 'problem', goal: '只研究这一道题，完整保留题干并核对原文参考答案。', materials: [{ title: '原文参考答案', text: '本例无参考答案；请独立求解，不编造原解。' }], sources: [source] } };
  await script(harness, { '独立备课这一题。': [request], [VAULT_SOLVER_REPLY_KEY]: '原页已收到，独立研究结果。' });
  await harness.ask(session, '独立备课这一题。');
  const children = await childSessions(harness, session);
  expect(children).toHaveLength(1);
  const child = (await harness.requests()).find(row => row.sessionId === children[0]!.sessionId)!;
  expect(child, '真实子请求不存在').toBeDefined();
  expect((child as AssembledRequest & { maxTokens: number }).maxTokens).toBe(32768);
  expect(reasoningEffortOf(child)).toBe('high');
  expect(child.toolSchemas).toEqual([]);
  const images = child.messages.flatMap(row => row.content).filter(block => block.type === 'image');
  expect(images).toHaveLength(1);
  expect(images[0]?.attachment?.attachmentId).toBeTruthy();
  expect(JSON.stringify(child.messages)).toContain(revision);
  expect((await harness.outcomes(session)).find(row => row.name === 'ask_worker')?.failed).toBe(false);

  const view = await classroomOf(harness, session);
  await configure(harness, session, view.revision, { provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL, reasoningEffort: 'high', maxTokens: 49152 });
  await script(harness, { '继续核对另一题。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求1+1。' } }], [VAULT_SOLVER_REPLY_KEY]: '2。' });
  await harness.ask(session, '继续核对另一题。');
  const next = (await harness.requests()).filter(isSolverRoute).at(-1)!;
  expect((next as AssembledRequest & { maxTokens: number }).maxTokens).toBe(49152);

  await writeFile(pdfPath, Buffer.concat([bytes, Buffer.from('\n% revised fixture\n')]));
  await script(harness, { '用旧页继续。': [request] });
  await harness.ask(session, '用旧页继续。');
  const failed = (await harness.outcomes(session)).filter(row => row.name === 'ask_worker').at(-1)!;
  expect(failed.failed).toBe(true);
  expect(failed.text).toContain('vault_reference_stale');
  expect(await childSessions(harness, session)).toHaveLength(2);
  expect((await classroomOf(harness, session)).tasks[0]?.status).toBe('failed');
}, 300_000);

test('教室 RPC 只投影双角色、模型清单与任务状态；解题者工具只挂教学会话', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();

  const view = await classroomOf(harness, session);
  // Fixed teacher plus a fixed solver: both role cards are real, neither carries an answer.
  expect(view.teacher.name).toBe(TEACHER_NAME);
  expect(view.teacher.description.length).toBeGreaterThan(0);
  expect(view.workers.map(row => row.id)).toEqual(['problem', 'lesson', 'review', 'general', 'exercise']);
  expect(view.workers[0]!.name.length).toBeGreaterThan(0);
  expect(view.workers[0]!.description.length).toBeGreaterThan(0);
  expect(view.workers[0]!.preferredModel).toBe(VAULT_SOLVER_MODEL);
  // Unconfigured must still resolve to the model the contract names: the
  // projection may keep no route or materialize the default one, never a different model.
  expect(view.workers[0]!.route === null || view.workers[0]!.route.model === VAULT_SOLVER_MODEL, JSON.stringify(view.workers[0]!.route)).toBe(true);
  expect(view.workers[0]!.ready, `default worker route is not ready: ${view.workers[0]!.reason ?? ''}`).toBe(true);
  expect(view.tasks).toEqual([]);
  // The value is authority only: no answer, no child id, no internal path.
  expect(Object.keys(view).sort()).toEqual(['models', 'revision', 'tasks', 'teacher', 'workers']);
  expect(unexpectedKeys(view.teacher, ['name', 'description'])).toEqual([]);
  for (const worker of view.workers) expect(unexpectedKeys(worker, ['id', 'name', 'description', 'preferredModel', 'route', 'ready', 'reason', 'tools'])).toEqual([]);
  for (const task of view.tasks) {
    expect(unexpectedKeys(task, ['id', 'preset', 'name', 'status', 'startedAt', 'finishedAt', 'inspectable'])).toEqual([]);
    expect(task.finishedAt, '未完成的任务不应带完成时间').toBeUndefined();
  }
  // The model list is the Host's own registered routes, not a client-side copy.
  const solverModels = view.models.filter(row => row.model === VAULT_SOLVER_MODEL);
  expect(solverModels.map(row => row.provider)).toEqual([VAULT_SOLVER_PROVIDER]);
  expect(solverModels.every(row => typeof row.label === 'string' && row.label.length > 0)).toBe(true);
  expect(solverModels.every(row => Array.isArray(row.reasoningEfforts))).toBe(true);
  expect(solverModels[0]?.reasoningEfforts.length).toBeGreaterThan(0);
  expect(view.models.some(row => row.provider === VAULT_TEST_PROVIDER && row.model === VAULT_TEST_MODEL)).toBe(true);

  // A teaching session offers the solver tool and no generic delegation bypass.
  const [turn] = await harness.ask(session, '今天讲这道题。', { '今天讲这道题。': '好。' });
  // Identity assembly only: the assembled request must carry this classroom's own
  // persona (resources/vault-teaching/persona.md), not just some teaching wording.
  // The full prompt text is deliberately not pinned here.
  const teacherSystem = effectiveSystemText(turn!);
  expect(teacherSystem, '教师请求里没有课堂自己的 persona').toContain('大肥鱼');
  expect(teacherSystem).toContain('你是教学者');
  const teacherTools = toolNames(turn!);
  expect(teacherTools).toContain('ask_worker');
  for (const bypass of ['subagent', 'subagent_fork', 'send_message', 'interrupt_agent']) {
    expect(teacherTools, `教学会话仍挂着通用委派工具 ${bypass}`).not.toContain(bypass);
  }
  // The ordinary preset is untouched: generic delegation stays, the solver is absent.
  const plain = await harness.createSession('standard');
  const [plainTurn] = await harness.ask(plain, '给我讲讲什么是向量。', { '给我讲讲什么是向量。': '向量可以看成……' });
  const plainTools = toolNames(plainTurn!);
  expect(plainTools).toContain('subagent');
  expect(plainTools).not.toContain('ask_worker');
}, 300_000);

test('解题者是零工具独立 spawn：默认用 gpt-5.6-sol，父私密上下文不进子，结果回父且投影不含解答', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  await script(harness, {
    '先记一个只有老师知道的备注。': `记住了：${PARENT_ONLY_MARKER}`,
    '请后台解题者算这道题。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 2+3。', focus: '只看结果', materials: [{ title: '题面', text: '2+3' }] } }],
    [VAULT_SOLVER_REPLY_KEY]: `${ANALYSIS_MARKER}：先用平方关系，再代入。`,
  });

  await harness.ask(session, '先记一个只有老师知道的备注。');
  const turns = await harness.ask(session, '请后台解题者算这道题。');

  // A real native child of this lesson, not a second turn in the parent.
  const children = await childSessions(harness, session);
  // The failure message carries the teacher's real tool list, so a missing
  // `ask_worker` is reported as wiring, not as an unexplained empty child list.
  const parentTools = toolNames(turns.at(-1) ?? (await harness.turns(session)).at(-1)!);
  expect(children, `没有真实原生子会话（本课工具：${parentTools.join(', ')}）：ask_worker 还没接进教学 preset`).toHaveLength(1);
  const childRequests = (await harness.requests()).filter(request => request.sessionId === children[0]!.sessionId);
  expect(childRequests.length).toBeGreaterThan(0);
  for (const request of childRequests) {
    // Default resolution picks the exact model the contract prefers, on its own route.
    expect(request, JSON.stringify(childRequests.map(row => [row.provider, row.model]))).toMatchObject({ provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL });
    // The child never sees the parent's turn, its persona, or a tool.
    expect(JSON.stringify(request)).not.toContain(PARENT_ONLY_MARKER);
    expect(effectiveSystemText(request), '解题者子会话继承了教师 persona').not.toContain('你是教学者');
    expect(request.toolSchemas, '解题者子会话拿到了工具').toEqual([]);
  }
  expect(childRequests.some(request => request.model === VAULT_TEST_MODEL)).toBe(false);

  // The answer comes back to the teacher as this tool's result, on the next assembled request.
  const outcome = (await harness.outcomes(session)).find(row => row.name === 'ask_worker');
  expect(outcome?.failed, outcome?.text).toBe(false);
  const payload = outcomeJson<SolverOutcome>(outcome!);
  expect(payload?.status).toBe('completed');
  expect(typeof payload?.taskId === 'string' && (payload.taskId?.length ?? 0) > 0).toBe(true);
  expect(payload?.analysis).toContain(ANALYSIS_MARKER);
  expect(toolResultTexts(turns.at(-1)!).join('\n')).toContain(ANALYSIS_MARKER);

  // The classroom projection shows status only: no answer, no child identity.
  const view = await classroomOf(harness, session);
  expect(view.tasks).toHaveLength(1);
  expect(view.tasks[0]?.status).toBe('completed');
  expect(typeof view.tasks[0]?.startedAt).toBe('string');
  expect(typeof view.tasks[0]?.finishedAt).toBe('string');
  // The flag the bench keys 查看分析 off is the Host's own spawn fact.
  expect(view.tasks[0]?.inspectable).toBe(true);
  const projection = JSON.stringify(view);
  expect(projection).not.toContain(ANALYSIS_MARKER);
  expect(projection).not.toContain(children[0]!.sessionId);
}, 300_000);

test('解题者路由按教室配置生效；没有匹配模型时明确失败且不静默降级', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  const initial = await classroomOf(harness, session);

  // An explicit route overrides the preferred model, and the class still reports it.
  const configured: SolverRoute = { provider: VAULT_TEST_PROVIDER, model: VAULT_TEST_MODEL };
  await configure(harness, session, initial.revision, configured);
  const after = await classroomOf(harness, session);
  expect(after.workers[0]!.route).toMatchObject(configured);
  expect(after.workers[0]!.ready).toBe(true);
  expect(after.revision).toBeGreaterThan(initial.revision);

  await script(harness, {
    '请解题者用配置的模型算题。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 1+1。' } }],
    [VAULT_SOLVER_REPLY_KEY]: `${ANALYSIS_MARKER}：一加一等于二。`,
  });
  await harness.ask(session, '请解题者用配置的模型算题。');
  const child = (await childSessions(harness, session))[0]!;
  expect(child, '配置路由后没有派发子会话').toBeDefined();
  const routed = (await harness.requests()).filter(request => request.sessionId === child.sessionId);
  expect(routed.map(request => `${request.provider}/${request.model}`)).toContain(`${VAULT_TEST_PROVIDER}/${VAULT_TEST_MODEL}`);
  expect(routed.map(request => request.model)).not.toContain(VAULT_SOLVER_MODEL);

  // Clearing the route returns to the preferred model instead of freezing the old one.
  await configure(harness, session, (await classroomOf(harness, session)).revision, null);
  const cleared = await classroomOf(harness, session);
  expect(cleared.workers[0]!.ready).toBe(true);
  expect(cleared.workers[0]!.route === null || cleared.workers[0]!.route.model === VAULT_SOLVER_MODEL, JSON.stringify(cleared.workers[0]!.route)).toBe(true);

  // No matching route: either the configuration is refused outright, or the
  // classroom reports not-ready with a reason. A silent fallback is a failure.
  const before = (await childSessions(harness, session)).length;
  const prior = await classroomOf(harness, session);
  const missing: SolverRoute = { provider: 'notara-vault-missing', model: VAULT_SOLVER_MODEL };
  let refusal: string | undefined;
  try { await configure(harness, session, prior.revision, missing); } catch (error) { refusal = (error as Error).message; }
  const view = await classroomOf(harness, session);
  if (refusal === undefined) {
    expect(view.workers[0]!.route).toMatchObject(missing);
    expect(view.workers[0]!.ready, '无匹配 provider 时教室仍报 ready').toBe(false);
    expect((view.workers[0]!.reason ?? '').trim().length).toBeGreaterThan(0);
    await script(harness, { '让解题者再算一道。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 2+2。' } }] });
    await harness.ask(session, '让解题者再算一道。');
    const outcome = (await harness.outcomes(session)).filter(row => row.name === 'ask_worker').at(-1);
    expect(outcome?.failed, `无匹配模型时 ask_worker 没有明确失败：${outcome?.text ?? 'no outcome'}`).toBe(true);
    expect(await childSessions(harness, session)).toHaveLength(before);
    expect((await harness.requests()).filter(request => request.sessionId !== session)).toHaveLength(0);
  } else {
    // A refused configuration must leave the教室 exactly as it was: no silent
    // fallback, no revision bump, no lost previous configuration.
    expect(refusal.length).toBeGreaterThan(0);
    expect(view.revision).toBe(prior.revision);
    expect(view.workers[0]!.route, `被拒绝的配置改动了已存路由（拒绝原因：${refusal}）`).toEqual(prior.workers[0]!.route);
  }
}, 300_000);

test('原生中断取消：任务终结、没有成功解答回到教师、迟到结果不再投递', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  await script(harness, {
    '让解题者慢慢算，我等着。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '慢慢算：求 3+4。' } }],
    [VAULT_SOLVER_REPLY_KEY]: { text: `${ANALYSIS_MARKER}${'…补充'.repeat(4000)}`, pauseMs: 20_000 },
  });

  // The teacher turn must not be awaited here: cancellation has to land while the task runs.
  harness.value(await harness.rpc('session/prompt', {
    request: { sessionId: session, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '让解题者慢慢算，我等着。' }] },
  }));
  // Cancel a task that really dispatched: poll until the child's own request
  // exists, so cancellation hits a running child instead of the spawn window.
  await expect.poll(async () => (await harness!.requests()).filter(isSolverRoute).length, { timeout: 60_000 }).toBeGreaterThan(0);
  const child = (await childSessions(harness, session))[0];
  expect(child, '取消前没有真实子会话：任务从未派发').toBeDefined();
  const task = (await classroomOf(harness, session)).tasks.find(row => row.status !== 'completed');
  expect(task, '取消前任务已经不在运行状态').toBeDefined();

  await cancel(harness, session, task!.id);
  await expect.poll(async () => (await classroomOf(harness!, session)).tasks.find(row => row.id === task!.id)?.finishedAt, { timeout: 60_000 }).not.toBeUndefined();
  const settled = (await classroomOf(harness, session)).tasks.find(row => row.id === task!.id)!;
  expect(settled.status, '取消后任务仍标为完成').not.toBe('completed');
  expect(settled.status).not.toBe('running');

  // The teacher turn settles without a fabricated success answer.
  await expect.poll(async () => (await harness!.sessions()).find(row => row.sessionId === session)?.running, { timeout: 60_000 }).not.toBe(true);
  const outcome = (await harness.outcomes(session)).filter(row => row.name === 'ask_worker').at(-1);
  expect(outcome, '取消后没有如实返回工具结果').toBeDefined();
  const payload = outcomeJson<SolverOutcome>(outcome!);
  expect(payload?.status, `取消后仍返回成功解答：${outcome?.text ?? ''}`).not.toBe('completed');
  expect(JSON.stringify(payload ?? {})).not.toContain(ANALYSIS_MARKER);
  expect(outcome!.text).not.toContain(ANALYSIS_MARKER);

  // The child itself stops: no late completion is projected or delivered.
  await expect.poll(async () => (await harness!.sessions()).find(row => row.sessionId === child!.sessionId)?.running, { timeout: 30_000 }).not.toBe(true);
  const requests = (await harness.requests()).length;
  await new Promise(resolve => setTimeout(resolve, 3_000));
  expect((await harness.requests()).length).toBe(requests);
  expect((await classroomOf(harness, session)).tasks.find(row => row.id === task!.id)?.status).not.toBe('completed');
}, 300_000);

test('重启后教室配置与解题者路由冷恢复，新任务仍走配置的模型与推理等级', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  const initial = await classroomOf(harness, session);
  const configured: SolverRoute = { provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL, reasoningEffort: 'high' };
  await configure(harness, session, initial.revision, configured);
  const saved = await classroomOf(harness, session);
  expect(saved.workers[0]!.route).toMatchObject(configured);

  await runtime.restart();
  harness = await connectVault(runtime);
  const restored = await classroomOf(harness, session);
  expect(restored.revision).toBe(saved.revision);
  expect(restored.teacher.name).toBe(TEACHER_NAME);
  expect(restored.workers[0]!.route).toMatchObject(configured);
  expect(restored.workers[0]!.ready).toBe(true);
  expect(restored.tasks).toEqual([]);

  await script(harness, {
    '重启之后让解题者再算一道。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 5+6。' } }],
    [VAULT_SOLVER_REPLY_KEY]: `${ANALYSIS_MARKER}：十一。`,
  });
  await harness.ask(session, '重启之后让解题者再算一道。');
  const child = (await childSessions(harness, session))[0];
  expect(child, '冷恢复后没有派发子会话').toBeDefined();
  const routed = (await harness.requests()).filter(request => request.sessionId === child!.sessionId);
  expect(routed.length).toBeGreaterThan(0);
  for (const request of routed) {
    expect(request).toMatchObject({ provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL });
    expect(reasoningEffortOf(request)).toBe('high');
  }
  const outcome = (await harness.outcomes(session)).find(row => row.name === 'ask_worker');
  expect(outcome?.failed, outcome?.text).toBe(false);
  expect(outcomeJson<SolverOutcome>(outcome!)?.analysis).toContain(ANALYSIS_MARKER);
}, 300_000);

test('同名模型挂在两个 provider 上时教室不替教师猜，明确配置后仍可工作', async () => {
  process.env[VAULT_SOLVER_AMBIGUOUS_ENV] = '1';
  try {
    runtime = await startVaultIsolated({ testModel: true });
    harness = await connectVault(runtime);
    const session = await harness.createSession();
    const view = await classroomOf(harness, session);
    const routes = view.models.filter(row => row.model === VAULT_SOLVER_MODEL).map(row => row.provider).sort();
    expect(routes).toEqual([VAULT_SOLVER_AMBIGUOUS_PROVIDER, VAULT_SOLVER_PROVIDER].sort());
    expect(view.workers[0]!.ready, '同名多 provider 时默认仍报 ready，等于替教师任选一个').toBe(false);
    expect((view.workers[0]!.reason ?? '').trim().length).toBeGreaterThan(0);

    // Dispatching without an explicit provider refuses instead of picking one.
    await script(harness, { '先不指定 provider 让解题者算一道。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 1+2。' } }] });
    await harness.ask(session, '先不指定 provider 让解题者算一道。');
    const refused = (await harness.outcomes(session)).filter(row => row.name === 'ask_worker').at(-1);
    expect(refused?.failed, `同名多 provider 且未配置时 ask_worker 没有明确失败：${refused?.text ?? 'no outcome'}`).toBe(true);
    expect(await childSessions(harness, session)).toHaveLength(0);

    await configure(harness, session, view.revision, { provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL });
    const configured = await classroomOf(harness, session);
    expect(configured.workers[0]!.ready).toBe(true);
    await script(harness, {
      '明确指定 provider 后再算一道。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 7+8。' } }],
      [VAULT_SOLVER_REPLY_KEY]: `${ANALYSIS_MARKER}：十五。`,
    });
    await harness.ask(session, '明确指定 provider 后再算一道。');
    const child = (await childSessions(harness, session))[0];
    expect(child, '明确配置后没有派发子会话').toBeDefined();
    const routed = (await harness.requests()).filter(request => request.sessionId === child!.sessionId);
    expect(routed.length).toBeGreaterThan(0);
    for (const request of routed) expect(request).toMatchObject({ provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL });
  } finally {
    delete process.env[VAULT_SOLVER_AMBIGUOUS_ENV];
  }
}, 300_000);

test('取消后同一学生输入不会被自动重跑，新用户消息才重新允许派发', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  const sameInput = '这一轮里解题者先算一次再说。', newInput = '我们换一道新题再让解题者算。';
  // One teacher turn asks twice: the second call is the agent loop retrying the
  // same student input after the first one was stopped.
  await script(harness, {
    [sameInput]: [
      { name: 'ask_worker', arguments: { preset: 'problem', goal: '先算：求 3+4。' } },
      { name: 'ask_worker', arguments: { preset: 'problem', goal: '先算：求 3+4。' } },
    ],
    [VAULT_SOLVER_REPLY_KEY]: { text: `${ANALYSIS_MARKER}：十七。`, pauseMs: 20_000 },
  });

  harness.value(await harness.rpc('session/prompt', {
    request: { sessionId: session, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: sameInput }] },
  }));
  await expect.poll(async () => (await harness!.requests()).filter(isSolverRoute).length, { timeout: 60_000 }).toBeGreaterThan(0);
  const task = (await classroomOf(harness, session)).tasks.find(row => row.status !== 'completed');
  expect(task, '取消前没有运行中的任务').toBeDefined();
  await cancel(harness, session, task!.id);

  await expect.poll(async () => (await harness!.sessions()).find(row => row.sessionId === session)?.running, { timeout: 90_000 }).not.toBe(true);
  const outcomes = (await harness.outcomes(session)).filter(row => row.name === 'ask_worker');
  expect(outcomes.length, '同一轮里的第二次 ask_worker 没有到达 Host').toBeGreaterThanOrEqual(2);
  expect(outcomes[0]?.failed, outcomes[0]?.text).toBe(true);
  expect(outcomes[1]?.failed, `取消后同一输入被自动重跑：${outcomes[1]?.text ?? 'no second outcome'}`).toBe(true);
  expect(outcomes[1]?.text ?? '').toMatch(/solver_paused|paused|暂停/i);
  expect(await childSessions(harness, session), '被暂停的重试仍然派发了子会话').toHaveLength(1);

  // A new user message is a new input: the solver is available again and completes.
  await script(harness, {
    [newInput]: [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '新题：求 8+9。' } }],
    [VAULT_SOLVER_REPLY_KEY]: `${ANALYSIS_MARKER}：十七。`,
  });
  const turns = await harness.ask(session, newInput);
  expect(await childSessions(harness, session), '新用户消息之后仍被暂停').toHaveLength(2);
  const latest = (await harness.outcomes(session)).filter(row => row.name === 'ask_worker').at(-1);
  expect(latest?.failed, latest?.text).toBe(false);
  expect(outcomeJson<SolverOutcome>(latest!)?.analysis).toContain(ANALYSIS_MARKER);
  expect(toolResultTexts(turns.at(-1)!).join('\n')).toContain(ANALYSIS_MARKER);
}, 300_000);

test('solverTask 把一次分析绑定到父会话与真实一次性子会话；投影只报可检查性，不暴露 child', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  await script(harness, {
    '请后台解题者算这道题。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 2+3。' } }],
    [VAULT_SOLVER_REPLY_KEY]: `${ANALYSIS_MARKER}：等于五。`,
  });
  await harness.ask(session, '请后台解题者算这道题。');

  const completed = (await classroomOf(harness, session)).tasks[0];
  expect(completed, '任务没有进入教室投影').toBeDefined();
  expect(completed!.status).toBe('completed');
  expect(completed!.inspectable, '已完成任务仍报不可查看').toBe(true);
  const outcome = (await harness.outcomes(session)).find(row => row.name === 'ask_worker');
  const taskId = outcomeJson<SolverOutcome>(outcome!)?.taskId ?? '';

  // 查看分析: the RPC resolves one real parent/child binding for this task. The
  // child id comes from the Host's own listChildren, so it must be the same
  // native child the session list already reports.
  const bindingResult = await harness.rpc<SolverTaskBinding>('notaraVault/solverTask', { input: { sessionId: session, taskId } });
  expect(bindingResult.ok, bindingResult.ok ? undefined : bindingResult.error.code).toBe(true);
  const binding = harness.value(bindingResult);
  expect(Object.keys(binding!).sort()).toEqual(['childSessionId', 'mode', 'parentSessionId', 'status']);
  expect(binding!.parentSessionId).toBe(session);
  expect(binding!.mode).toBe('one-shot');
  expect(binding!.status).toBe('completed');
  const children = await childSessions(harness, session);
  expect(children).toHaveLength(1);
  expect(binding!.childSessionId).toBe(children[0]!.sessionId);
  expect(binding!.childSessionId).not.toBe(session);
  // The child carries the analysis; the parent's classroom projection never does.
  expect((await harness.requests()).filter(request => request.sessionId === binding!.childSessionId).length).toBeGreaterThan(0);
  const projection = JSON.stringify(await classroomOf(harness, session));
  expect(projection).not.toContain(binding!.childSessionId);
  expect(projection).not.toContain(ANALYSIS_MARKER);
}, 300_000);

test('solverTask 属于本课：外课会话不能借另一个会话的 taskId 读到它的绑定', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  await script(harness, {
    '请后台解题者算这道题。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 2+3。' } }],
    [VAULT_SOLVER_REPLY_KEY]: `${ANALYSIS_MARKER}：等于五。`,
  });
  await harness.ask(session, '请后台解题者算这道题。');
  const taskId = outcomeJson<SolverOutcome>((await harness.outcomes(session)).find(row => row.name === 'ask_worker')!)?.taskId ?? '';

  const other = await harness.createSession();
  // The transport code is the gateway's own (gateway/internal): the plugin maps
  // its domain code to fixed learner-safe copy at this boundary, so the refusal
  // is read from that message. A silent success is the failure this test forbids.
  const foreign = await harness.rpc<unknown>('notaraVault/solverTask', { input: { sessionId: other, taskId } });
  expect(foreign.ok, '外课会话读到了另一节课的后台记录').toBe(false);
  expect(foreign.ok ? '' : foreign.error.message).toBe('找不到这次分析任务，请刷新后再试。');

  const own = await harness.rpc<SolverTaskBinding>('notaraVault/solverTask', { input: { sessionId: session, taskId } });
  expect(own.ok, own.ok ? undefined : own.error.message).toBe(true);
  expect(own.ok ? own.value.childSessionId : '').not.toBe('');

  // A standard (non-teaching) session has no classroom at all, so the RPC stays
  // refused there too instead of creating a second chat pathway.
  const plain = await harness.createSession('standard');
  const plainClassroom = await harness.rpc('notaraVault/classroom', { input: { sessionId: plain } });
  expect(plainClassroom.ok, '标准会话被当成了教室').toBe(false);
  expect(plainClassroom.ok ? '' : plainClassroom.error.message).toBe('请在教学会话中使用此功能。');
  const plainTask = await harness.rpc('notaraVault/solverTask', { input: { sessionId: plain, taskId } });
  expect(plainTask.ok, '标准会话借 taskId 打开了后台记录').toBe(false);
  expect(plainTask.ok ? '' : plainTask.error.message).toBe('请在教学会话中使用此功能。');
}, 300_000);

test('任务运行中即可查看分析，取消后停止且不留迟到结果', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  await script(harness, {
    '让解题者慢慢算，我先看着。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '慢慢算：求 3+4。' } }],
    [VAULT_SOLVER_REPLY_KEY]: { text: `${ANALYSIS_MARKER}${'…补充'.repeat(4000)}`, pauseMs: 8_000 },
  });

  // The teacher turn is not awaited: the running task has to be inspectable.
  harness.value(await harness.rpc('session/prompt', {
    request: { sessionId: session, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '让解题者慢慢算，我先看着。' }] },
  }));
  // The Host writes `running` before the spawn provider has returned the child id,
  // so there is a real (sub-second) window where the flag is still false. The claim
  // under test is the running-and-inspectable state, which must be reached while the
  // scripted 8s pause still holds the task open — not the instant the row appears.
  await expect.poll(async () => (await classroomOf(harness!, session)).tasks.find(row => row.status === 'running' && row.inspectable === true)?.id ?? '', { timeout: 60_000 }).not.toBe('');
  const row = (await classroomOf(harness, session)).tasks.find(row => row.status === 'running')!;
  expect(row.inspectable, '运行中的任务报不可查看，教师就只能在结束后打开').toBe(true);
  const taskId = row.id;

  const live = harness.value(await harness.rpc<SolverTaskBinding>('notaraVault/solverTask', { input: { sessionId: session, taskId } }));
  expect(live.mode).toBe('one-shot');
  expect(live.parentSessionId).toBe(session);
  expect(live.status).toBe('running');
  const child = (await childSessions(harness, session))[0];
  expect(child, '运行中却没有真实子会话').toBeDefined();
  expect(live.childSessionId).toBe(child!.sessionId);

  await cancel(harness, session, taskId);
  await expect.poll(async () => (await classroomOf(harness!, session)).tasks.find(row => row.id === taskId)?.status, { timeout: 60_000 }).toBe('canceled');
  const settled = (await classroomOf(harness, session)).tasks.find(row => row.id === taskId)!;
  expect(settled.finishedAt).not.toBeUndefined();
  // An interrupted analysis keeps its record (the child really ran), but it is
  // never reported as a finished analysis and never delivers a late answer.
  expect(settled.inspectable).toBe(true);
  // 取消 settles the task first; the teacher turn reports it afterwards, so the
  // outcome is read only once the parent session is idle again.
  await expect.poll(async () => (await harness!.sessions()).find(row => row.sessionId === session)?.running, { timeout: 60_000 }).not.toBe(true);
  const outcome = (await harness.outcomes(session)).filter(row => row.name === 'ask_worker').at(-1);
  expect(outcome?.failed, `取消后仍返回成功解答：${outcome?.text ?? 'no outcome'}`).toBe(true);
  expect(JSON.stringify(outcomeJson<SolverOutcome>(outcome!) ?? {})).not.toContain(ANALYSIS_MARKER);
  expect(outcome!.text).not.toContain(ANALYSIS_MARKER);
  const requests = (await harness.requests()).length;
  await new Promise(resolve => setTimeout(resolve, 3_000));
  expect((await harness.requests()).length).toBe(requests);
}, 300_000);

test('冷重启后已完成任务的 solverTask 绑定仍可查到，且不会退回教室投影', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  await script(harness, {
    '重启之前先算一道。': [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 5+6。' } }],
    [VAULT_SOLVER_REPLY_KEY]: `${ANALYSIS_MARKER}：十一。`,
  });
  await harness.ask(session, '重启之前先算一道。');
  const taskId = outcomeJson<SolverOutcome>((await harness.outcomes(session)).find(row => row.name === 'ask_worker')!)?.taskId ?? '';
  const before = harness.value(await harness.rpc<SolverTaskBinding>('notaraVault/solverTask', { input: { sessionId: session, taskId } }));
  expect(before.mode).toBe('one-shot');

  await runtime.restart();
  harness = await connectVault(runtime);

  const after = harness.value(await harness.rpc<SolverTaskBinding>('notaraVault/solverTask', { input: { sessionId: session, taskId } }));
  expect(after).toEqual(before);
  const row = (await classroomOf(harness, session)).tasks.find(task => task.id === taskId);
  expect(row, '重启后教室投影丢掉了这件任务').toBeDefined();
  expect(row!.status).toBe('completed');
  expect(row!.inspectable).toBe(true);
  // The durable projection still tells the teacher a record exists without
  // disclosing the child session.
  expect(JSON.stringify(await classroomOf(harness, session))).not.toContain(before.childSessionId);
}, 300_000);

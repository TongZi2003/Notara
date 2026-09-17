import sharp from 'sharp';
import { afterEach, expect, test } from 'vitest';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { PluginCandidate, PluginView, WorldbookView, WorkbenchContent } from '@studyforge/contracts/plugins';
import type { ClassroomRuntimeView } from '@studyforge/contracts/classroom';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

const fixture = JSON.parse(await readFile(resolve('tests/fixtures/classroom-seed.json'), 'utf8'));
let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); });
const value = <T>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };
type ModelRequest = { sessionId: string; purpose?: string; provider?: string; model?: string; reasoningEffort?: string; messages: { id?: string; role: string; source: { kind: string; plugin?: string; avatar?: string }; content: { type: string; text?: string; content?: { text?: string }[] }[] }[]; toolNames: string[] };
const logs = async (): Promise<ModelRequest[]> => (await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const requestText = (row: ModelRequest): string => JSON.stringify(row.messages);

test('teacher-spawned classmates are isolated, public replies return once, private work stays private and continuation survives restart', async () => {
  runtime = await startIsolated({ testModel: true }); let client = await connectRuntime(runtime);
  const candidate = value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare', { input: { kind: 'directory', path: resolve('examples/plugins/worldbook') } }));
  const installed = value(await client.rpc<PluginView>('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion: 0, trustNative: false } }));
  const session = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {})), id = 'plugin-' + installed.ref.slice(7) + '-worldbook', target = { ...session, id };
  const routes = value(await client.rpc<{ provider: string; model: string }[]>('notaraClassroomView/modelRoutes', {}));
  expect(routes.some(route => route.provider === 'studyforge-test' && route.model === 'study-model-a')).toBe(true);
  value(await client.rpc('studyforgeCourses/update', { input: { ...session, expectedVersion: 0, operationId: 'private-teacher-context', patch: { temporaryInstructions: 'PARENT_PRIVATE_PROMPT：这段教师私有准备不交给同学。' } } }));
  expect(value(await client.rpc<WorkbenchContent>('studyforgePlugins/openWorkbench', { input: target })).kind).toBe('classroom');
  let world = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
  const avatar = value(await client.rpc<any>('notaraClassroomView/uploadAvatar', { input: { base64: (await sharp({ create: { width: 64, height: 64, channels: 3, background: '#a6bbcd' } }).png().toBuffer()).toString('base64') } }));
  world.document.classroom = structuredClone(fixture.classroom);
  world.document.classroom!.roles[0]!.route = { provider: 'studyforge-test', model: 'study-model-a' };
  world.document.classroom!.roles[0]!.avatar = avatar.ref;
  const peerRole = world.document.classroom!.roles.find(role => role.id === 'peer')!;
  peerRole.relations = [{ target: 'student', label: '同桌', intimacy: 55, note: '开学起坐在一起，会互借笔记。' }, { target: 'critic', label: '前后桌', note: '讨论常互怼。' }];
  world.document.classroom!.rules = world.document.classroom!.rules.map(rule => ({ ...rule, enabled: rule.trigger.kind === 'manual' }));
  world = value(await client.rpc<WorldbookView>('studyforgePlugins/saveWorldbook', { input: { ...target, expectedVersion: world.revision, operationId: 'prepare', document: world.document } }));
  value(await client.rpc('studyforgePlugins/useWorldbook', { input: { ...target, expectedVersion: world.useRevision, enabled: true } }));
  const send = async (text: string): Promise<void> => {
    const before = (await logs()).filter(row => row.sessionId === session.sessionId).length;
    value(await client.rpc('session/prompt', { request: { ...session, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } }));
    try { await expect.poll(async () => (await logs()).filter(row => row.sessionId === session.sessionId).length, { timeout: 10000 }).toBeGreaterThan(before); }
    catch (error) {
      const home = join(runtime!.root, 'home'), files = (await readdir(home, { recursive: true })).filter(file => file.endsWith('.jsonl'));
      const events = (await Promise.all(files.map(file => readFile(join(home, file), 'utf8')))).join('\n').split('\n').filter(line => /turn\/end|step\/end|error/.test(line)).join('\n');
      throw new Error(String(error) + '\n' + runtime!.log().slice(-3000) + '\n' + events.slice(-10000));
    }
    await expect.poll(async () => value(await client.rpc<any>('session/list', { _request: {} })).items.find((row: any) => row.sessionId === session.sessionId)?.running, { timeout: 30000 }).toBe(false);
  };
  const call = (name: string, args: unknown) => send('[tools]' + JSON.stringify([{ name: 'load_tools', arguments: { names: [name] } }, { name, arguments: args }]));
  const read = () => client.rpc<ClassroomRuntimeView>('notaraClassroomView/read', { input: target }).then(value);
  await send('PARENT_ONLY_SECRET：这段旧课堂内容不交给同学。');
  await call('ask_classmate', { id, roleId: 'critic', task: '检查给定推论。', materials: [{ title: '被评议原话', text: 'PUBLIC_MATERIAL：所有正方形是矩形，所以所有矩形都是正方形。' }], destination: 'conversation', routeOverride: { provider: 'studyforge-test', model: 'study-model-b' } });
  await expect.poll(async () => (await read()).tasks[0]?.status, { timeout: 30000 }).toBe('completed');
  await expect.poll(async () => (await read()).tasks[0]?.replySequence, { timeout: 30000 }).toBeDefined();
  const publicTask = (await read()).tasks[0]!;
  expect(publicTask.materials[0]!.text).toContain('PUBLIC_MATERIAL');
  const childRequests = (await logs()).filter(row => row.sessionId.startsWith('classmate-'));
  expect(childRequests.length).toBeGreaterThan(0); const childId = childRequests[0]!.sessionId;
  expect(childRequests.some(row => row.provider === 'studyforge-test' && row.model === 'study-model-b')).toBe(true);
  for (const row of childRequests) { expect(row.toolNames).toEqual([]); expect(requestText(row)).not.toContain('PARENT_ONLY_SECRET'); expect(requestText(row)).not.toContain('PARENT_PRIVATE_PROMPT'); }
  expect(childRequests.some(row => requestText(row).includes('PUBLIC_MATERIAL'))).toBe(true);
  // The critic child sees peer's declared relation toward it as pure situation.
  expect(childRequests.some(row => requestText(row).includes('同桌 对你：前后桌'))).toBe(true);
  expect(childRequests.every(row => requestText(row).includes('仅是角色背景设定'))).toBe(true);
  // The teacher receives the resolved relationship map with the classroom section.
  const teacherRows = (await logs()).filter(row => row.sessionId === session.sessionId);
  expect(teacherRows.some(row => requestText(row).includes('to\\":\\"杠精同学') && requestText(row).includes('intimacy\\":55'))).toBe(true);
  await call('ask_classmate', { id, roleId: 'assistant', task: '依据标准核对', materials: [{ title: '参考标准', text: 'PRIVATE_ANSWER：参考解只交老师。' }], destination: 'teacher' });
  await expect.poll(async () => (await read()).tasks[0]?.status, { timeout: 30000 }).toBe('completed');
  const privateTask = (await read()).tasks[0]!;
  expect(privateTask.destination).toBe('teacher'); expect(privateTask.materials).toEqual([]); expect(privateTask.reply).toBe(''); expect(privateTask.task).not.toContain('标准');
  await runtime.restart(); client = await connectRuntime(runtime);
  expect((await read()).tasks.find(task => task.ref === publicTask.ref)?.replySequence).toBe(publicTask.replySequence);
  await call('continue_classmate', { ref: publicTask.ref, question: 'FOLLOW_SAME_TASK：请补充一个反例。' });
  await expect.poll(async () => (await read()).tasks[0]?.status, { timeout: 30000 }).toBe('completed');
  const followed = (await read()).tasks[0]!; expect(followed.ref).not.toBe(publicTask.ref); expect(followed.roleId).toBe('critic');
  const continuedRequests = (await logs()).filter(row => row.sessionId === childId);
  expect(continuedRequests.some(row => requestText(row).includes('FOLLOW_SAME_TASK') && requestText(row).includes('PUBLIC_MATERIAL'))).toBe(true);
  for (const row of continuedRequests) expect(row.toolNames).toEqual([]);
  const latestParent = (await logs()).filter(row => row.sessionId === session.sessionId).at(-1)!;
  const publicReplies = latestParent.messages.filter(message => message.source.kind === 'plugin' && message.source.plugin === 'notara-classroom-speaker');
  expect(publicReplies.some(message => JSON.stringify(message).includes('PRIVATE_ANSWER'))).toBe(false);
  expect(publicReplies.length).toBeLessThanOrEqual(2);
  expect(publicReplies.length).toBeGreaterThan(0);
  expect(publicReplies.every(message => message.source.avatar === avatar.ref)).toBe(true);
  expect((await logs()).some(row => requestText(row).includes(avatar.base64))).toBe(false);
  value(await client.rpc('studyforgePlugins/setEnabled', { input: { ref: installed.ref, expectedVersion: installed.revision, enabled: false } }));
  expect((await client.rpc('notaraClassroomView/read', { input: target })).ok).toBe(false);
}, 180000);

test('upgrading the worldbook preserves user entries, adds classroom defaults and rejects stale edits', async () => {
  runtime = await startIsolated({ testModel: true }); let client = await connectRuntime(runtime);
  const directory = join(runtime.root, 'worldbook-package'); await mkdir(directory);
  const original = structuredClone(fixture);
  const manifest = JSON.parse(await readFile(resolve('examples/plugins/worldbook/package.json'), 'utf8'));
  manifest.name = 'classroom-upgrade-test'; manifest.notara.skills = []; delete manifest.notara.worldbooks[0].templates;
  const source = async (version: string, classroom: boolean) => { await writeFile(join(directory, 'package.json'), JSON.stringify({ ...manifest, version })); await writeFile(join(directory, 'worldbook.json'), JSON.stringify({ entries: [], ...(classroom ? { classroom: original.classroom } : {}) })); };
  const install = async (expectedVersion: number) => { const candidate = value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare', { input: { kind: 'directory', path: directory } })); return value(await client.rpc<PluginView>('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion, trustNative: false } })); };
  await source('1.0.0', false); let plugin = await install(0);
  const a = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {})), id = 'plugin-' + plugin.ref.slice(7) + '-worldbook';
  value(await client.rpc('studyforgePlugins/saveWorldbook', { input: { ...a, id, expectedVersion: 0, operationId: 'my-entry', document: { entries: [{ title: '学生自编背景', content: '保留这段原有内容', keywords: [], enabled: true, always: true }] } } }));
  await source('1.1.0', true); plugin = await install(plugin.revision);
  const b = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {})), target = { ...b, id };
  let world = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
  expect(world.document.entries[0]?.title).toBe('学生自编背景'); expect(world.document.classroom?.roles).toHaveLength(4);
  world.document.classroom!.roles[0]!.name = '边界同学';
  value(await client.rpc('studyforgePlugins/saveWorldbook', { input: { ...target, expectedVersion: world.revision, operationId: 'classroom-edit', document: world.document } }));
  expect((await client.rpc('studyforgePlugins/saveWorldbook', { input: { ...target, expectedVersion: world.revision, operationId: 'stale', document: { entries: [] } } })).ok).toBe(false);
  await runtime.restart(); client = await connectRuntime(runtime);
  world = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
  expect(world.document.classroom?.roles[0]?.name).toBe('边界同学'); expect(world.document.entries[0]?.content).toBe('保留这段原有内容');
}, 90000);

test('situational fields reach the classmate persona and runtime intimacy gates worldbook entries', async () => {
  runtime = await startIsolated({ testModel: true }); const client = await connectRuntime(runtime);
  const candidate = value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare', { input: { kind: 'directory', path: resolve('examples/plugins/worldbook') } }));
  const plugin = value(await client.rpc<PluginView>('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion: 0, trustNative: false } }));
  const session = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {})), target = { ...session, id: 'plugin-' + plugin.ref.slice(7) + '-worldbook' };
  const world = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
  world.document.classroom = structuredClone(fixture.classroom);
  world.document.classroom!.scenario = 'SCENE_SETTING：开学第一周的晚自习教室。';
  world.document.classroom!.studentPersona = 'STUDENT_ROLE：刚转来的学生。';
  world.document.classroom!.rules = world.document.classroom!.rules.map(rule => ({ ...rule, enabled: rule.trigger.kind === 'manual' }));
  const peer = world.document.classroom!.roles.find(role => role.id === 'peer')!;
  peer.personality = 'PERSONALITY_MARK：随和，爱举生活例子。';
  peer.greeting = 'GREETING_MARK：这道题卡哪儿了？';
  peer.relations = [{ target: 'student', label: '同桌', intimacy: 30, note: '开学起坐在一起。' }];
  world.document.entries.push({ title: 'GATED_ENTRY', content: '同桌熟络后才会开的玩笑。', keywords: ['闲聊'], enabled: true, always: false, role: 'peer', intimacyAtLeast: 60 });
  value(await client.rpc('studyforgePlugins/saveWorldbook', { input: { ...target, expectedVersion: world.revision, operationId: 'scene', document: world.document } }));
  value(await client.rpc('studyforgePlugins/useWorldbook', { input: { ...target, expectedVersion: 0, enabled: true } }));
  const send = async (text: string): Promise<void> => {
    value(await client.rpc('session/prompt', { request: { ...session, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } }));
    await expect.poll(async () => value(await client.rpc<any>('session/list', { _request: {} })).items.find((row: any) => row.sessionId === session.sessionId)?.running, { timeout: 30000 }).toBe(false);
  };
  const call = (name: string, args: unknown) => send('[tools]' + JSON.stringify([{ name: 'load_tools', arguments: { names: [name] } }, { name, arguments: args }]));
  const teacherRequests = async () => (await logs()).filter(row => row.sessionId === session.sessionId && !requestText(row).includes('dsh-session-title-llm'));
  await send('@同桌（教室）闲聊几句。');
  let teacherText = requestText((await teacherRequests()).at(-1)!);
  expect(teacherText).toContain('SCENE_SETTING'); expect(teacherText).not.toContain('GATED_ENTRY');
  await call('adjust_classroom_intimacy', { id: target.id, roleId: 'peer', target: 'student', value: 75 });
  await send('@同桌（教室）再闲聊几句。');
  teacherText = requestText((await teacherRequests()).at(-1)!);
  expect(teacherText).toContain('GATED_ENTRY'); expect(teacherText).toContain('intimacy\\":75');
  await call('ask_classmate', { id: target.id, roleId: 'peer', task: '陪学生闲聊一句。', materials: [{ title: '闲聊', text: '随便聊聊今天。' }], destination: 'conversation' });
  await expect.poll(async () => (await logs()).some(row => row.sessionId.startsWith('classmate-')), { timeout: 30000 }).toBe(true);
  const childText = requestText((await logs()).filter(row => row.sessionId.startsWith('classmate-')).at(-1)!);
  for (const mark of ['SCENE_SETTING', 'STUDENT_ROLE', 'PERSONALITY_MARK', 'GREETING_MARK', '仅是角色背景设定', '亲密度 75']) expect(childText).toContain(mark);
}, 120000);

test('periodic and successful note events reach the teacher once and do not count generated turns', async () => {
  runtime = await startIsolated({ testModel: true }); let client = await connectRuntime(runtime);
  const candidate = value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare', { input: { kind: 'directory', path: resolve('examples/plugins/worldbook') } }));
  const plugin = value(await client.rpc<PluginView>('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion: 0, trustNative: false } }));
  const session = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {})), target = { ...session, id: 'plugin-' + plugin.ref.slice(7) + '-worldbook' };
  const world = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
  world.document.classroom = structuredClone(fixture.classroom);
  world.document.classroom!.rules = [
    { id: 'periodic', title: 'ROUND_CUE', enabled: true, trigger: { kind: 'round', every: 2 }, action: { kind: 'teacher', instruction: '检查当前讨论是否需要简短板书。' } },
    { id: 'stage', title: 'STAGE_CUE', enabled: true, trigger: { kind: 'stage' }, action: { kind: 'teacher', instruction: '结合刚刚保存的笔记，准备下一步。' } },
  ];
  value(await client.rpc('studyforgePlugins/saveWorldbook', { input: { ...target, expectedVersion: 0, operationId: 'rules', document: world.document } }));
  value(await client.rpc('studyforgePlugins/useWorldbook', { input: { ...target, expectedVersion: 0, enabled: true } }));
  const read = () => client.rpc<ClassroomRuntimeView>('notaraClassroomView/read', { input: target }).then(value);
  const idle = async () => { await expect.poll(async () => value(await client.rpc<any>('session/list', { _request: {} })).items.find((row: any) => row.sessionId === session.sessionId)?.running, { timeout: 20000 }).toBe(false); };
  const send = async (text: string, count: number) => { value(await client.rpc('session/prompt', { request: { ...session, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } })); await expect.poll(async () => (await read()).completedRounds, { timeout: 20000 }).toBe(count); await idle(); };
  const cues = async () => { const messages = (await logs()).filter(row => row.sessionId === session.sessionId).flatMap(row => row.messages).filter(message => message.source.kind === 'plugin' && message.source.plugin === 'notara-classroom-rule'); return [...new Map(messages.map(message => [message.id, message])).values()]; };
  await send('我们讨论条件。', 1); expect(await cues()).toHaveLength(0);
  await send('继续检查推论。', 2);
  await expect.poll(async () => (await cues()).length, { timeout: 20000 }).toBe(1); await idle();
  expect(JSON.stringify(await cues())).toContain('ROUND_CUE'); expect((await read()).completedRounds).toBe(2);
  await send('这一段可以整理成笔记了。', 3);
  const note = { ...session, operationId: 'settled-note', content: { title: '条件与推论', presentation: 'note', front: '从已知条件出发检查推论，讨论不等于掌握。' } };
  value(await client.rpc('studyforgeLearning/createCard', { input: note }));
  await expect.poll(async () => (await cues()).length, { timeout: 20000 }).toBe(2); await idle();
  expect(JSON.stringify(await cues())).toContain('STAGE_CUE');
  value(await client.rpc('studyforgeLearning/createCard', { input: note }));
  expect((await client.rpc('studyforgeLearning/createCard', { input: { ...note, operationId: 'invalid-note', content: { ...note.content, title: '' } } })).ok).toBe(false);
  await runtime.restart(); client = await connectRuntime(runtime); expect((await read()).completedRounds).toBe(3);
  value(await client.rpc('notaraClassroomView/stop', { input: target })); expect((await read()).suspended).toBe(true);
  value(await client.rpc('studyforgeLearning/createCard', { input: { ...note, operationId: 'paused-note', content: { ...note.content, title: '暂停后的补充' } } }));
  expect(await cues()).toHaveLength(2);
}, 120000);

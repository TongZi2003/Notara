import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ExecutionAccess, ExecutionBindingSchema, LEARNING_COMPOSITION, CREATION_COMPOSITION, type NativeExecution } from '../../packages/domain/src/access/execution-binding.ts';
import { StudentFileSystem } from '../../packages/host/src/access/filesystem.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { startIsolated } from '../../scripts/dev-isolated.ts';
import { mountNativeAgentHarness } from '../fixtures/native-agent.ts';
import { installToolAccess } from '../../packages/host/src/access/context.ts';
import * as SearchTools from '@deepseek-ai/dsh-tool-fs-search';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import CodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread';
import { SessionId } from '@deepseek-ai/dsh-session';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import * as FileTools from '@deepseek-ai/dsh-tool-fs';
import * as ObservationPolicy from '@deepseek-ai/dsh-fs-observation-policy';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Include from '@deepseek-ai/cordis-plugin-include';
import Group from '@deepseek-ai/cordis-plugin-group';
import AgentPresets from '@deepseek-ai/dsh-agent-presets';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import WebRuntime from '@deepseek-ai/dsh-web';
import SubagentModelSelection from '@deepseek-ai/dsh-tool-subagent/model-selection-settings';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'sf-access-')), root = join(base, 'a'), other = join(base, 'b');
  await Promise.all([mkdir(join(root, 'library/数学'), { recursive: true }), mkdir(join(root, 'library/物理'), { recursive: true }), mkdir(join(root, 'packs/讲义'), { recursive: true }), mkdir(join(root, 'packs/别的作品'), { recursive: true }), mkdir(other)]);
  await Promise.all([writeFile(join(root, 'library/数学/source.md'), '学生A数学'), writeFile(join(root, 'library/物理/source.md'), '学生A物理'), writeFile(join(other, 'source.md'), '学生B同名材料'), writeFile(join(root, 'packs/讲义/main.md'), '作品原文'), writeFile(join(root, 'packs/别的作品/main.md'), '别的作品')]);
  const ctx = new Context(); await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, root, 'a', createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai'));
  cleanups.push(async () => { await ctx.fiber.dispose(); await owner.close(); await rm(base, { recursive: true, force: true }); });
  const records = await owner.collection('binding', ExecutionBindingSchema);
  const sessions = new Map<string, NativeExecution>([
    ['learn', { sessionId: 'learn', cwd: root, preset: LEARNING_COMPOSITION }],
    ['create', { sessionId: 'create', cwd: root, preset: CREATION_COMPOSITION }],
  ]);
  const access = new ExecutionAccess(root, 'a', records, async id => { const value = sessions.get(id); if (!value) throw new Error('native_session_missing'); return value; });
  ctx.reflect.provide('studyforgeAccess', access); await ctx.plugin(StudentFileSystem, { cwd: root });
  return { ctx, access, root, other, sessions, records };
}

test('native fs reads across own subjects and refuses another workspace, traversal and symlink ancestors', async () => {
  const { ctx, access, root, other } = await fixture();
  const binding = await access.forSession('learn'), cwd = access.scope(binding);
  for (const subject of ['数学', '物理']) expect(await ctx.fs.readText(await ctx.fs.resolve(`library/${subject}/source.md`, { cwd }))).toContain('学生A');
  await symlink(other, join(root, 'outside'));
  await symlink(join(other, 'source.md'), join(root, 'alias.md'));
  for (const path of [join(other, 'source.md'), '../b/source.md', 'outside/source.md', 'outside/new.md', 'alias.md', 'file://' + join(other, 'source.md')]) {
    await expect(ctx.fs.resolve(path, { cwd })).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' });
    await expect(ctx.fs.lstat(path, { cwd })).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' });
  }
  const target = await ctx.fs.resolve('library/数学/source.md', { cwd });
  expect(() => ctx.fs.writeText(target, 'no')).toThrow();
  expect(await readFile(join(other, 'source.md'), 'utf8')).toBe('学生B同名材料');
});

test('creation grants only its selected project and individual read-only references', async () => {
  const { ctx, access, root } = await fixture();
  await expect(access.forSession('create')).rejects.toMatchObject({ code: 'creation_selection_required' });
  await expect(access.selectCreation('create', '讲义', ['.'])).rejects.toMatchObject({ code: 'reference_denied' });
  const binding = await access.selectCreation('create', '讲义', ['library/数学/source.md']), cwd = access.scope(binding);
  const target = await ctx.fs.resolve('packs/讲义/main.md', { cwd });
  await ctx.fs.writeText(target, '作品修订');
  expect(await ctx.fs.readText(target)).toBe('作品修订');
  const reference = await ctx.fs.resolve('library/数学/source.md', { cwd });
  expect(await ctx.fs.readText(reference)).toBe('学生A数学');
  expect(() => ctx.fs.editText(reference, { oldString: '学生', newString: 'no', replaceAll: false })).toThrow();
  for (const path of ['.', 'library/物理/source.md', 'packs/别的作品/main.md']) await expect(ctx.fs.resolve(path, { cwd })).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' });
  expect(await readFile(join(root, 'library/数学/source.md'), 'utf8')).toBe('学生A数学');
});

test('revoked targets and cross-session virtual scope fail; malformed native bindings never inherit cwd grants', async () => {
  const { ctx, access, sessions, other } = await fixture();
  const creator = await access.selectCreation('create', '讲义', ['library/数学/source.md']);
  const target = await ctx.fs.resolve('library/数学/source.md', { cwd: access.scope(creator) });
  await access.selectCreation('create', '讲义', [], creator.revision);
  expect(() => ctx.fs.readText(target)).toThrow();
  const learner = await access.forSession('learn');
  await expect(access.run(learner, () => ctx.fs.resolve(access.scope(creator)))).rejects.toThrow();
  sessions.set('bad', { sessionId: 'bad', cwd: other, preset: LEARNING_COMPOSITION });
  await expect(access.forSession('bad')).rejects.toMatchObject({ code: 'binding_workspace_denied' });
  sessions.set('learn', { ...sessions.get('learn')!, preset: 'standard' });
  await expect(access.forSession('learn')).rejects.toMatchObject({ code: 'binding_purpose_missing' });
  expect(access.isCurrent(learner)).toBe(false);
  await expect(ctx.fs.resolve('library/数学/source.md')).rejects.toThrow();
});

test('real native Remote authorizes read, readAll, readRelated and stat using the native session identity', async () => {
  const runtime = await startIsolated(); cleanups.push(() => runtime.stop());
  const origin = new URL(runtime.authUrl).origin, root = join(runtime.root, 'classroom');
  await mkdir(join(root, 'library'), { recursive: true });
  await writeFile(join(root, 'library/source.md'), '跨学科的本人材料');
  await writeFile(join(root, 'library/related.txt'), '相关原文');
  await writeFile(join(runtime.root, 'other.txt'), '不得泄露');
  await symlink(join(runtime.root, 'other.txt'), join(root, 'alias.txt'));
  const login = await fetch(runtime.authUrl, { redirect: 'manual' });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function rpc(method: string, args: unknown) {
    const response = await fetch(origin + '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) });
    return { status: response.status, body: await response.json() };
  }
  const created = await rpc('session/create', { request: { cwd: root, agentPreset: LEARNING_COMPOSITION } });
  expect(created.status, runtime.log()).toBe(200);
  expect(created.body.result, JSON.stringify(created.body) + '\n' + runtime.log()).toMatchObject({ ok: true });
  const workspaceFileScopeId = created.body.result.value.sessionId;
  expect(workspaceFileScopeId, JSON.stringify(created.body)).toBeTypeOf('string');
  for (const method of ['read', 'readAll', 'stat']) {
    const result = await rpc('workspaceFiles/' + method, { workspaceFileScopeId, path: 'library/source.md', ...(method === 'read' ? { range: {} } : {}) });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.type).toBe('server-response');
    expect(result.body.result, JSON.stringify(result.body)).toMatchObject({ ok: true });
  }
  const related = await rpc('workspaceFiles/readRelated', { workspaceFileScopeId, path: 'library/source.md', relativePath: 'related.txt' });
  expect(related.body.result).toMatchObject({ ok: true });
  for (const path of ['../other.txt', join(runtime.root, 'other.txt'), 'alias.txt']) {
    for (const method of ['read', 'readAll', 'stat']) {
      const result = await rpc('workspaceFiles/' + method, { workspaceFileScopeId, path, ...(method === 'read' ? { range: {} } : {}) });
      expect(JSON.stringify(result.body)).not.toContain('不得泄露');
      expect(result.body.result).toMatchObject({ ok: false });
    }
  }
});

test('real grep/glob registry calls respect session grants; shell-equivalent PTC cannot bypass them', async () => {
  const { access, root, other } = await fixture();
  const native = await mountNativeAgentHarness(); cleanups.push(() => native.dispose());
  const ctx = native.ctx;
  await ctx.plugin(LocalSubprocess);
  await ctx.plugin(SearchTools, { sampleOverCapGlobResults: false });
  await ctx.plugin(CodeRuntime, {});
  installToolAccess(ctx, access);
  const { agent: learner } = await ctx.agents.create({ sessionId: SessionId('learn'), meta: { cwd: root, agentPreset: LEARNING_COMPOSITION } });
  const { agent: creator } = await ctx.agents.create({ sessionId: SessionId('create'), meta: { cwd: root, agentPreset: CREATION_COMPOSITION } });
  await access.selectCreation('create', '讲义', ['library/数学/source.md']);
  const call = (agent: typeof learner, name: string, args: unknown) => ctx.tools.execute({ agent, name, arguments: args, callId: ToolCallId(crypto.randomUUID()), signal: new AbortController().signal });
  for (const name of ['grep', 'glob']) {
    const base = name === 'grep' ? { pattern: '学生A' } : { pattern: '**/*.md' };
    const own = await call(learner, name, { ...base, path: 'library' });
    expect(own.isError, JSON.stringify(own)).toBe(false);
    expect(JSON.stringify(own.value)).toContain('数学');
    const foreign = await call(learner, name, { ...base, path: other });
    expect(foreign).toMatchObject({ isError: true });
    const omittedCreatorPath = await call(creator, name, base);
    expect(omittedCreatorPath).toMatchObject({ isError: true });
    const allowedCreator = await call(creator, name, { ...base, path: 'packs/讲义' });
    expect(allowedCreator.isError, JSON.stringify(allowedCreator)).toBe(false);
    const deniedCreator = await call(creator, name, { ...base, path: 'library/物理' });
    expect(deniedCreator).toMatchObject({ isError: true });
  }
  learner.ctx.tools.presentAs('ptc');
  const ptc = await call(learner, 'run_code', { code: 'return await tools.grep({pattern:"学生",path:' + JSON.stringify(other) + '});', description: '读取不属于本人的材料' });
  expect(ptc).toMatchObject({ isError: true });
  expect(JSON.stringify(ptc)).toContain('本次用途未开放任意命令执行');
  expect(JSON.stringify(ptc)).not.toContain('学生B同名材料');
});

test('native read-before-edit and stale protection survive the authorized creation backend', async () => {
  const { access, root } = await fixture();
  const native = await mountNativeAgentHarness(); cleanups.push(() => native.dispose());
  const ctx = native.ctx;
  ctx.reflect.provide('studyforgeAccess', access);
  await ctx.plugin(StudentFileSystem, { cwd: root });
  await ctx.plugin(ObservationPolicy);
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: root });
  await ctx.plugin(FileTools, {});
  installToolAccess(ctx, access);
  const { agent } = await ctx.agents.create({ sessionId: SessionId('create'), meta: { cwd: root, agentPreset: CREATION_COMPOSITION } });
  await access.selectCreation('create', '讲义', []);
  const call = (name: string, args: unknown) => ctx.tools.execute({ agent, name, arguments: args, callId: ToolCallId(crypto.randomUUID()), signal: new AbortController().signal });
  const file_path = 'packs/讲义/main.md';
  const edit = { file_path, old_string: '作品原文', new_string: '作品修订', replace_all: false };
  expect(await call('edit', edit)).toMatchObject({ isError: true });
  expect(await readFile(join(root, file_path), 'utf8')).toBe('作品原文');
  expect(await call('read', { file_path })).toMatchObject({ isError: false });
  await writeFile(join(root, file_path), '外部新版本');
  const stale = await call('edit', edit);
  expect(stale).toMatchObject({ isError: true });
  expect(JSON.stringify(stale)).toMatch(/stale|changed|version/i);
  expect(await readFile(join(root, file_path), 'utf8')).toBe('外部新版本');
  expect(await call('read', { file_path })).toMatchObject({ isError: false });
  const saved = await call('edit', { ...edit, old_string: '外部新版本' });
  expect(saved.isError, JSON.stringify(saved)).toBe(false);
  expect(await readFile(join(root, file_path), 'utf8')).toBe('作品修订');
});

test('a native child inherits the real learning composition and is bound by its own Session', async () => {
  const { root, records, other } = await fixture();
  const native = await mountNativeAgentHarness({ subagents: true }); cleanups.push(() => native.dispose());
  const ctx = native.ctx;
  ctx.baseUrl = pathToFileURL(resolve('.')).href + '/';
  await ctx.plugin(Loader);
  ctx.loader.builtins.include = Include;
  ctx.loader.builtins.group = Group;
  await ctx.plugin(SkillRegistry, {});
  await ctx.plugin(WebRuntime, {});
  await ctx.plugin(SubagentModelSelection, {});
  await ctx.plugin(LocalSubprocess);
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: root });
  const access = new ExecutionAccess(root, 'a', records, async id => {
    const lease = await ctx.sessionQuery.observeSession(SessionId(id));
    try { return { sessionId: lease.header.id, cwd: lease.header.cwd, preset: lease.projections?.values.agentPreset ?? lease.header.agentPreset }; }
    finally { lease[Symbol.dispose](); }
  });
  ctx.reflect.provide('studyforgeAccess', access);
  await ctx.plugin(StudentFileSystem, { cwd: root });
  installToolAccess(ctx, access);
  await ctx.plugin(AgentPresets, { default: LEARNING_COMPOSITION, roots: [{ path: resolve('packages/host/presets'), trust: 'system' }], includeShippedRoot: false, includeUserRoot: false });
  const { agent: parent } = await ctx.agents.create({ sessionId: SessionId('preset-parent'), meta: { cwd: root, agentPreset: LEARNING_COMPOSITION }, agentOptions: { provider: 'scripted', model: 'scripted-1' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, LEARNING_COMPOSITION); } });
  const run = await ctx.subagents.start('spawn', { label: '搜索', parent, persona: '只整理检索结果。', prompt: [{ type: 'text', text: '读取物理资料' }], signal: new AbortController().signal });
  try {
    expect((await run.result).stopReason).toBe('completed');
    const child = run.localAgent!;
    expect(child.session.header).toMatchObject({ cwd: root, parentSession: parent.session.id, agentPreset: LEARNING_COMPOSITION });
    expect(ctx.agentPresets.composedPreset(child.ctx)).toBe(LEARNING_COMPOSITION);
    const binding = await access.forSession(child.session.id);
    expect(binding).toMatchObject({ sessionId: child.session.id, purpose: 'learning' });
    const request = native.adapter.forSession(child.session.id)[0]!;
    expect(request.toolNames).toEqual(expect.arrayContaining(['read', 'grep', 'web_search', 'subagent']));
    expect(request.toolNames).not.toEqual(expect.arrayContaining(['bash']));
    expect(request.system).toContain('只整理检索结果');
    const read = (file_path: string) => ctx.tools.execute({ agent: child, name: 'read', arguments: { file_path }, callId: ToolCallId(crypto.randomUUID()), signal: new AbortController().signal });
    const own = await read('library/物理/source.md');
    expect(own.isError, JSON.stringify(own)).toBe(false);
    expect(JSON.stringify(own)).toContain('学生A物理');
    expect(await read(join(other, 'source.md'))).toMatchObject({ isError: true });
  } finally { await run.dispose(); }
});

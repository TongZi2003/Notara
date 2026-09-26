import assert from 'node:assert/strict';
import test from 'node:test';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { Session } from '@deepseek-ai/dsh-session';

import { NotaraVaultRemote } from './index.js';
import { NotaraTeaching } from './teaching-runtime.js';
import { createAgentVaultIO } from './agent-io.js';

/**
 * The real seam the Host-side review (P2, 客户端 Vault 根取 process.cwd()) named:
 * a lesson's session cwd can differ from the process/startup workspace. These
 * tests drive the real Remote, the real teaching runtime, the real native writer
 * and the real local filesystem against temp workspaces — no shared instance.
 */

const sessionMeta = (id, cwd) => ({ version: 3, id, createdAt: Date.now(), isSeeded: false, cwd, agentPreset: 'notara-teacher' });

/**
 * `startup` names the workspace the Host registered for itself at boot:
 * 'physics' (a real second workspace, so a wrong fallback silently reads
 * another vault) or 'stray' (a workspace that is not registered at all, so a
 * wrong fallback can only fail).
 */
async function openWorld(t, { startup, layout = 'legacy' }) {
  const base = await mkdtemp(join(tmpdir(), 'notara-remote-scope-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const math = join(base, 'math'), physics = join(base, 'physics'), stray = join(base, 'stray');
  for (const dir of [math, physics, stray]) {
    // 旧布局：资料在 vault/ 下，工作区根另有 README.md 与第二个工作区目录。
    // 直接根：工作区目录本身就是资料根。
    if (layout === 'legacy') {
      await mkdir(join(dir, 'vault', '卡片'), { recursive: true });
      await writeFile(join(dir, 'vault', '卡片', '旧资料.md'), '# 旧资料\n');
      await writeFile(join(dir, 'README.md'), '# 工作区说明\n');
      await mkdir(join(dir, 'other'), { recursive: true });
    } else {
      await mkdir(dir, { recursive: true });
    }
  }
  const rows = [{ id: 'math', path: math, title: '数学' }, { id: 'physics', path: physics, title: '物理' }];
  const cwdById = { 'lesson-math': math, 'lesson-physics': physics };
  const ctx = new Context();
  new LocalFileSystem(ctx, { cwd: base, diffBasisMaxBytes: 10 * 1024 * 1024 });
  ctx.reflect.provide('workspaceRegistry', { list: () => rows });
  // The native session store: `inspect` is the only thing that knows a lesson's
  // real cwd, so this is the seam under test rather than a test-only shortcut.
  ctx.reflect.provide('sessionController', {
    async inspect(id) {
      const cwd = cwdById[id];
      if (!cwd) throw new Error('session_not_found');
      return { meta: { cwd } };
    },
  });
  const root = startup === 'physics' ? physics : stray;
  const teaching = new NotaraTeaching(ctx, { root }, { resolveAgent: async () => ({}), flush: async () => {}, archive: async () => {} });
  const remote = new NotaraVaultRemote(ctx);
  const execFor = sessionId => ({ agent: { session: Session.create(sessionId, [], sessionMeta(sessionId, cwdById[sessionId])) }, signal: new AbortController().signal, callId: `remote-scope:${sessionId}` });
  // The model's writer only exists after native approval; `writeApproved` is that
  // capability, not a test shortcut. Reads need no capability at all.
  const modelFor = sessionId => createAgentVaultIO(ctx, execFor(sessionId), { writeApproved: true });
  return { base, math, physics, stray, ctx, teaching, remote, execFor, modelFor };
}

const exists = async path => lstat(path).then(() => true, () => false);

test('模型 save 与 Remote.read 命中同一文件（会话工作区 ≠ 启动工作区）', async t => {
  const world = await openWorld(t, { startup: 'physics' });
  const path = '知识/同根.md', content = '---\ntype: note\ntitle: 同根\n---\n# 同根\n\n模型写的内容。\n';

  // 模型侧：真实 session.cwd 是 math，不是启动工作区 physics，更不是进程根。
  const saved = await world.modelFor('lesson-math').save(path, content, null);
  assert.equal(saved.path, path);
  assert.equal(await readFile(join(world.math, 'vault', path), 'utf8'), content);
  assert.equal(await exists(join(world.physics, 'vault', path)), false, '模型没有写进启动工作区');
  assert.notEqual(resolve(world.math), resolve(process.cwd()));

  // 界面侧：资产页带着本课 sessionId 读，读到的是同一个文件、同一个 revision。
  const read = await world.remote.read({ path, sessionId: 'lesson-math' });
  assert.equal(read.content, content);
  assert.equal(read.revision, saved.revision);

  // 没有会话时不静默回落到 process.cwd：它回到启动注册工作区，因此读不到。
  await assert.rejects(world.remote.read({ path }), /vault_file_not_found/);
  await assert.rejects(world.remote.read({ path: '知识/同根.md', sessionId: 'lesson-physics' }), /vault_file_not_found/);
});

test('store 按 root 缓存：同一会话复用，两个工作区不共享', async t => {
  const world = await openWorld(t, { startup: 'physics' });
  await mkdir(join(world.math, 'vault/知识'), { recursive: true });
  await mkdir(join(world.physics, 'vault/知识'), { recursive: true });
  await writeFile(join(world.math, 'vault/知识/m.md'), '# 数学\n');
  await writeFile(join(world.physics, 'vault/知识/p.md'), '# 物理\n');

  assert.equal(await world.remote.storeFor({ sessionId: 'lesson-math' }), await world.remote.storeFor({ sessionId: 'lesson-math' }));
  assert.notEqual(await world.remote.storeFor({ sessionId: 'lesson-math' }), await world.remote.storeFor({ sessionId: 'lesson-physics' }));

  assert.deepEqual((await world.remote.list({ sessionId: 'lesson-math' })).files.map(file => file.path), ['卡片/旧资料.md', '知识/m.md']);
  assert.deepEqual((await world.remote.list({ sessionId: 'lesson-physics' })).files.map(file => file.path), ['卡片/旧资料.md', '知识/p.md']);

  // 模板也落在会话自己的根，不写进另一个课堂。
  assert.ok((await world.remote.templates({ sessionId: 'lesson-math' })).length > 0);
  assert.equal(await exists(join(world.math, 'vault/_templates')), true);
  assert.equal(await exists(join(world.physics, 'vault/_templates')), false);

  // 任务读取同样跟着会话根：同一个相对路径在两个课堂里是两个文件。
  await writeFile(join(world.math, 'vault/待办.md'), '# 待办\n\n- [ ] 数学作业\n');
  assert.deepEqual((await world.remote.tasks({ path: '待办.md', sessionId: 'lesson-math' })).map(task => task.text), ['数学作业']);
  await assert.rejects(world.remote.tasks({ path: '待办.md' }), /vault_file_not_found/);
});

test('界面 save 与模型共用一个写者和同一份 revision 规则', async t => {
  const world = await openWorld(t, { startup: 'physics' });
  const path = '卡片/甲.md', content = '---\ntype: card\ntitle: 甲\n---\n# 甲\n\n从资产页保存。\n';

  const saved = await world.remote.save({ path, content, expectedRevision: null, sessionId: 'lesson-math' });
  assert.equal(await readFile(join(world.math, 'vault', path), 'utf8'), content);
  const fromModel = await world.modelFor('lesson-math').read(path);
  assert.equal(fromModel.content, content);
  assert.equal(fromModel.revision, saved.revision);

  // 外部改动之后，界面带着旧 revision 保存会失败，而不是覆盖较新内容。
  await writeFile(join(world.math, 'vault', path), content + '\n外部补充。\n');
  await assert.rejects(world.remote.save({ path, content: content + '\n界面补充。\n', expectedRevision: saved.revision, sessionId: 'lesson-math' }), /vault_revision_conflict/);
  assert.match(await readFile(join(world.math, 'vault', path), 'utf8'), /外部补充/);
});

test('没有会话、启动根也未注册时明确失败，而不是造一个假工作区', async t => {
  const world = await openWorld(t, { startup: 'stray' });
  await assert.rejects(world.remote.read({ path: '知识/甲.md' }), /vault_scope_unavailable/);
  await assert.rejects(world.remote.list({}), /vault_scope_unavailable/);
  await assert.rejects(world.remote.templates({}), /vault_scope_unavailable/);
  assert.equal(await exists(join(world.stray, 'vault/知识')), false, '失败的请求没有留下目录');

  // 同一个 Remote 带着真实会话仍然可用：失败点就是“无法定位工作区”。
  await mkdir(join(world.math, 'vault/知识'), { recursive: true });
  await writeFile(join(world.math, 'vault/知识/甲.md'), '# 甲\n');
  assert.equal((await world.remote.read({ path: '知识/甲.md', sessionId: 'lesson-math' })).title, '甲');
  // 未知会话同样明确失败，不会被当成启动工作区。
  await assert.rejects(world.remote.read({ path: '知识/甲.md', sessionId: 'ghost' }), /session_not_found/);
});

test('Remote 只接受形状正确的 sessionId', async t => {
  const world = await openWorld(t, { startup: 'physics' });
  for (const sessionId of ['', 42, {}, true]) {
    await assert.rejects(world.remote.read({ path: '知识/甲.md', sessionId }), /vault_session_invalid/);
  }
  await assert.rejects(world.remote.read({ path: '知识/甲.md', sessionId: 'x'.repeat(201) }), /vault_session_invalid/);
});
test('worker persona crosses the exact Remote input boundary without widening other fields', async () => {
  const { NotaraVaultRemote } = await import('./index.js');
  const calls=[];
  const remote={teachingCall:async(name,input)=>{calls.push({name,input});return input;}};
  const input={sessionId:'one',expectedRevision:0,preset:'review',route:null,tools:'none',persona:'温和简洁的核验助手'};
  assert.equal((await NotaraVaultRemote.prototype.configureSolver.call(remote,input)).persona,input.persona);
  await assert.rejects(NotaraVaultRemote.prototype.configureSolver.call(remote,{...input,workspace:'/unrelated'}),/vault_input_invalid/);
  assert.equal(calls.length,1);
});

test('用户直接选中的资料目录即使残留旧版空 vault/ 也读写自身', async t => {
  const world = await openWorld(t, { startup: 'physics', layout: 'direct' });
  // 用户目录里本来就有自己的资料；旧版本还在旁边留下了空 vault/ 和自动模板。
  await mkdir(join(world.math, '知识'), { recursive: true });
  await writeFile(join(world.math, '知识', '自有资料.md'), '# 自有资料\n');
  await mkdir(join(world.math, 'vault', '_templates'), { recursive: true });
  await writeFile(join(world.math, 'vault', '_templates', 'lesson.md'), '# {{title}}\n');
  const path = '卡片/直接.md', content = '---\ntype: card\ntitle: 直接\n---\n# 直接\n\n用户目录自己的资料。\n';

  const saved = await world.modelFor('lesson-math').save(path, content, null);
  assert.equal(await readFile(join(world.math, path), 'utf8'), content);
  assert.equal(await exists(join(world.math, 'vault', path)), false);
  assert.equal(await exists(join(world.physics, path)), false, '没有写进启动工作区');

  const read = await world.remote.read({ path, sessionId: 'lesson-math' });
  assert.equal(read.content, content);
  assert.equal(read.revision, saved.revision);
  const files=(await world.remote.list({ sessionId: 'lesson-math' })).files.map(file => file.path);
  assert.ok(files.includes('卡片/直接.md'));
  assert.ok(!files.includes('vault/卡片/直接.md'), '资料没有落进旧版误建的 vault/');

  // 内置模板落在同一个根，而不是旧版误建的 vault/ 里。
  assert.ok((await world.remote.templates({ sessionId: 'lesson-math' })).length > 0);
  assert.equal(await exists(join(world.math, '_templates')), true);
  assert.ok((await world.remote.templates({ sessionId: 'lesson-math' })).some(file => file.path === 'lesson.md'));
});

test('PDF 批注与 Remote、模型共用同一资料根', async t => {
  const legacy = await openWorld(t, { startup: 'physics' });
  await mkdir(join(legacy.math, 'vault', '媒体'), { recursive: true });
  await writeFile(join(legacy.math, 'vault', '媒体', '讲义.pdf'), Buffer.from('%PDF-synthetic'));
  const read = await legacy.remote.pdfAnnotations({ path: '媒体/讲义.pdf', sessionId: 'lesson-math' });
  const saved = await legacy.remote.updatePdfAnnotations({
    sessionId: 'lesson-math', path: '媒体/讲义.pdf', action: 'add-annotation', expectedRevision: null, layerId: read.layers[0].id, page: 1, rect: [0.1, 0.1, 0.3, 0.2],
    note: '旧布局批注', expectedPdfRevision: read.pdfRevision,
  });
  assert.equal(saved.annotations.length, 1);
  assert.equal(await exists(join(legacy.math, 'vault', '.notara', 'pdf-annotations')), true);
  assert.equal(await exists(join(legacy.math, '.notara')), false, '批注没有写进工作区根');

  const direct = await openWorld(t, { startup: 'physics', layout: 'direct' });
  await mkdir(join(direct.math, '媒体'), { recursive: true });
  await writeFile(join(direct.math, '媒体', '讲义.pdf'), Buffer.from('%PDF-synthetic'));
  const directRead = await direct.remote.pdfAnnotations({ path: '媒体/讲义.pdf', sessionId: 'lesson-math' });
  await direct.remote.updatePdfAnnotations({
    sessionId: 'lesson-math', path: '媒体/讲义.pdf', action: 'add-annotation', expectedRevision: null, layerId: directRead.layers[0].id, page: 1, rect: [0.1, 0.1, 0.3, 0.2],
    note: '直接根批注', expectedPdfRevision: directRead.pdfRevision,
  });
  assert.equal(await exists(join(direct.math, '.notara', 'pdf-annotations')), true);
});

// Contract tests for the native Vault CLI (`vault-cli.js`).
//
// These run the real entry point as its own process, the way the teacher model
// reaches it through the approved local Bash tool: JSON on stdin, one JSON
// document out, a non-zero exit for a failure. They are written for the main
// integration pass; the CLI implementation itself must not depend on them.
//
// Not run as part of this change — the repository rules say tests are executed
// by whoever owns the wiring, and no build/service here was started.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const CLI = fileURLToPath(new URL('./vault-cli.js', import.meta.url));
const exists = path => lstat(path).then(() => true, () => false);
const judged = { keyStep: '解释基底的作用', result: 'done' };

function run(argv, { input = '', env = {} } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...argv], {
      env: { ...process.env, DSH_NOTARA_WORKSPACE: '', DSH_NOTARA_WORKSPACE_ID: '', DSH_SESSION_ID: '', DSH_NOTARA_CALL_ID: '', ...env },
    });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('close', code => resolve({ code, out: out.trim(), err: err.trim(), json: out.trim() ? JSON.parse(out) : null, errorJson: err.trim() ? JSON.parse(err) : null }));
    child.stdin.end(input);
  });
}

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'notara-vault-cli-'));
  const card = '---\ntype: card\ntitle: 基底\ntags: [math]\n---\n\n基底给出坐标语言。\n';
  await mkdir(join(root, 'vault', '卡片'), { recursive: true });
  await writeFile(join(root, 'vault', '卡片', '基底.md'), card);
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(root, { recursive: true, force: true }); });
  return { root, revision: createHash('sha256').update(card, 'utf8').digest('hex').slice(0, 24) };
}

test('help is self-describing and never needs a workspace or stdin', async () => {
  const top = await run(['help']);
  assert.equal(top.code, 0);
  assert.equal(top.json.program, 'DSH_NOTARA_CLI');
  assert.deepEqual(Object.keys(top.json.commands).sort(), ['calendar', 'create-route', 'lesson-log', 'lesson-outline', 'lesson-section', 'pdf-outline', 'pdf-page', 'record-review', 'review-queue', 'revise-route', 'route-outline', 'schedule-lesson', 'skill-list', 'skill-read', 'skill-save', 'source-cards', 'undo-review', 'write-batch']);

  const command = await run(['record-review', '--help']);
  assert.equal(command.code, 0);
  assert.equal(command.json.stdin.additionalProperties, false);
  assert.deepEqual(Object.keys(command.json.stdin.fields), ['path', 'expectedRevision', 'keyStep', 'result', 'note']);
  assert.ok(command.json.rejects.includes('sessionId'));
  for (const key of ['keyStep', 'result']) assert.ok(command.json.example.includes(key));
});

test('the schema rejects identity and unknown fields before touching any file', async t => {
  const { root, revision } = await workspace(t);
  const env = { DSH_NOTARA_WORKSPACE: root, DSH_NOTARA_WORKSPACE_ID: 'cli-test', DSH_SESSION_ID: 'cli-session' };

  const identity = await run(['record-review'], { env, input: JSON.stringify({ path: '卡片/基底.md', expectedRevision: revision, ...judged, note: '好', sessionId: 'forged' }) });
  assert.equal(identity.code, 2);
  assert.equal(identity.errorJson.error.code, 'cli_field_unknown');
  assert.equal(identity.errorJson.error.field, 'sessionId');

  const recordDate = await run(['record-review'], { env, input: JSON.stringify({ path: '卡片/基底.md', expectedRevision: revision, ...judged, note: '好', date: '2026-09-22' }) });
  assert.equal(recordDate.code, 2);
  assert.equal(recordDate.errorJson.error.field, 'date');

  const unknown = await run(['calendar'], { env, input: '{"from":"2026-09-01","to":"2026-09-30","actor":"teacher"}' });
  assert.equal(unknown.code, 2);
  assert.equal(unknown.errorJson.error.field, 'actor');

  // Nothing was written by any rejected call.
  assert.match(await readFile(join(root, 'vault/卡片/基底.md'), 'utf8'), /^---\ntype: card\ntitle: 基底/);
});

test('without a bound environment a command fails instead of guessing a root', async () => {
  const result = await run(['review-queue'], { input: '{"status":"all"}' });
  assert.equal(result.code, 1);
  assert.equal(result.errorJson.error.code, 'cli_workspace_required');
  assert.match(result.errorJson.error.next, /--workspace/);
});

test('exec-bound calendar keeps the requested IANA timezone', async t => {
  const { root } = await workspace(t);
  const env = {
    DSH_NOTARA_WORKSPACE: root,
    DSH_NOTARA_WORKSPACE_ID: 'cli-timezone',
    DSH_SESSION_ID: 'cli-timezone-session',
    DSH_NOTARA_CALL_ID: 'cli-timezone-call',
    TZ: 'Asia/Shanghai',
  };
  const result = await run(['calendar'], { env, input: JSON.stringify({ from: '2026-10-01', to: '2026-10-31', timeZone: 'Pacific/Auckland' }) });
  assert.equal(result.code, 0, result.err);
  assert.equal(result.json.result.timeZone, 'Pacific/Auckland');
});

test('standalone --workspace is the only explicit path, and records as actor self', async t => {
  const { root, revision } = await workspace(t);
  const env = { DSH_NOTARA_WORKSPACE: '', DSH_NOTARA_WORKSPACE_ID: '', DSH_SESSION_ID: '', DSH_NOTARA_CALL_ID: '' };

  const queue = await run(['review-queue', '--workspace', root], { env, input: '{"status":"all"}' });
  assert.equal(queue.code, 0);
  assert.equal(queue.json.result.hits[0].path, '卡片/基底.md');
  assert.equal(queue.json.result.standalone, true);

  const recorded = await run(['record-review', '--workspace', root], { env, input: JSON.stringify({ path: '卡片/基底.md', expectedRevision: revision, result: 'done', note: '能自己解释基底的作用。' }) });
  assert.equal(recorded.code, 0);
  assert.equal(recorded.json.result.actor, 'self');
  assert.equal(recorded.json.result.sessionId, null);
  assert.equal(recorded.json.result.state.mastery, 1);
  assert.match(await readFile(join(root, 'vault/卡片/基底.md'), 'utf8'), /review_history:/);
});

test('CLI records an unchecked key step without a schedule, preserves evidence, enforces CAS and supports undo', async t => {
  const { root, revision } = await workspace(t);
  const { parseFrontmatter } = await import('./frontmatter.js');
  const path = join(root, 'vault/卡片/基底.md');
  const args = { path: '卡片/基底.md', expectedRevision: revision, result: 'unchecked', note: '老师讲了怎样选基底，学生说清了坐标为什么唯一；自己选基底讲过，还没试。' };
  const result = await run(['record-review', '--workspace', root], { input: JSON.stringify(args) });
  assert.equal(result.code, 0);
  assert.equal(result.json.result.scheduleChanged, false);
  assert.equal(result.json.result.state.learned, false);
  const saved = await readFile(path, 'utf8');
  const fields = parseFrontmatter(saved).frontmatter;
  assert.equal(fields.review_history[0].result, 'unchecked');
  assert.equal(fields.review_history[0].actor, 'self');
  const stale = await run(['record-review', '--workspace', root], { input: JSON.stringify({ ...args, ...judged }) });
  assert.notEqual(stale.code, 0);
  assert.equal(await readFile(path, 'utf8'), saved);
  for (const [retired, value] of [['passed', true], ['assessments', [{ ability: '熟练：解释基底', outcome: 'demonstrated' }]], ['depth', []], ['nextCheck', '边界']]) {
    const oldWrite = await run(['record-review', '--workspace', root], { input: JSON.stringify({ ...args, expectedRevision: result.json.result.revision, [retired]: value }) });
    assert.equal(oldWrite.code, 2);
    assert.equal(oldWrite.errorJson.error.code, 'review_request_invalid');
    assert.equal(oldWrite.errorJson.error.field, retired);
    assert.match(oldWrite.errorJson.error.next, /keyStep/);
  }
  const undone = await run(['undo-review', '--workspace', root], { input: JSON.stringify({ path: args.path, expectedRevision: result.json.result.revision }) });
  assert.equal(undone.code, 0);
  assert.equal(undone.json.result.state.learned, false);
  assert.ok(parseFrontmatter(await readFile(path, 'utf8')).frontmatter.review_history[0].revertedAt);
});

test('oversized stdin is refused without reading the workspace', async () => {
  const result = await run(['create-route'], { input: JSON.stringify({ title: 'x', lessons: [{ title: 'y'.repeat(70 * 1024) }] }) });
  assert.equal(result.code, 2);
  assert.equal(result.errorJson.error.code, 'cli_stdin_too_large');
});

test('record errors identify the repair field and Unicode note limits match the writer', async t => {
  const { root, revision } = await workspace(t);
  const args = { path: '卡片/基底.md', expectedRevision: revision, ...judged, note: '💡'.repeat(2100) };
  for (const [change, code, field] of [[{ result: 'demonstrated' }, 'review_result_invalid', 'result'], [{ keyStep: 'x'.repeat(201) }, 'review_key_step_invalid', 'keyStep']]) {
    const invalid = await run(['record-review', '--workspace', root], { input: JSON.stringify({ ...args, ...change }) });
    assert.equal(invalid.errorJson.error.code, code);
    assert.equal(invalid.errorJson.error.field, field);
  }
  const valid = await run(['record-review', '--workspace', root], { input: JSON.stringify(args) });
  assert.equal(valid.code, 0);
});

test('the teacher must name the key step it judged', async t => {
  const { root, revision } = await workspace(t);
  const env = { DSH_NOTARA_WORKSPACE: root, DSH_NOTARA_WORKSPACE_ID: 'cli-test', DSH_SESSION_ID: 'cli-session', DSH_NOTARA_CALL_ID: 'call-1' };
  const unnamed = await run(['record-review'], { env, input: JSON.stringify({ path: '卡片/基底.md', expectedRevision: revision, result: 'missed', note: '没做出来。' }) });
  assert.equal(unnamed.errorJson.error.code, 'review_key_step_required');
  const named = await run(['record-review'], { env, input: JSON.stringify({ path: '卡片/基底.md', expectedRevision: revision, ...judged, note: '自己解释了基底的作用。' }) });
  assert.equal(named.code, 0);
  assert.equal(named.json.result.actor, 'teacher');
});

test('batch writes preserve literal Markdown, report partial failure and retry only failed items', async t => {
  const { root } = await workspace(t);
  const literal = '# 公式与代码\n\n$$\\frac{1}{2}$$\n`$HOME` 和 `$(touch NEVER)` 都是正文。\n';
  const batch = { files: [
    { op: 'create', path: '卡片/新卡.md', content: literal },
    { op: 'create', path: '卡片/基底.md', content: '# 不应覆盖\n' },
    { op: 'edit', path: '卡片/基底.md', oldText: '基底给出坐标语言。', newText: '基底提供坐标的参照。' },
  ] };
  // Duplicate targets are a malformed batch, not a partially executed one.
  const duplicate = await run(['write-batch', '--workspace', root], { input: JSON.stringify(batch) });
  assert.equal(duplicate.code, 2);
  await assert.rejects(readFile(join(root, 'vault/卡片/新卡.md')), /ENOENT/);
  batch.files.pop();
  const first = await run(['write-batch', '--workspace', root], { input: JSON.stringify(batch) });
  assert.equal(first.code, 1);
  assert.equal(first.json.ok, false);
  assert.equal(first.json.result.savedCount, 1);
  assert.equal(first.json.result.failedCount, 1);
  assert.equal(first.json.result.results[0].saved, true);
  assert.equal(first.json.result.results[1].error.code, 'vault_revision_conflict');
  assert.equal(await readFile(join(root, 'vault/卡片/新卡.md'), 'utf8'), literal);
  assert.match(await readFile(join(root, 'vault/卡片/基底.md'), 'utf8'), /基底给出坐标语言/);
  const fixed = await run(['write-batch', '--workspace', root], { input: JSON.stringify({ files: [{ op: 'edit', path: '卡片/基底.md', oldText: '基底给出坐标语言。', newText: '基底提供坐标的参照。' }] }) });
  assert.equal(fixed.code, 0);
  assert.equal(fixed.json.result.savedCount, 1);
  assert.match(await readFile(join(root, 'vault/卡片/基底.md'), 'utf8'), /title: 基底/);
  assert.match(await readFile(join(root, 'vault/卡片/基底.md'), 'utf8'), /基底提供坐标的参照/);
});

test('a batch edit matches a CRLF file written on Windows and keeps its line endings', async t => {
  const { root } = await workspace(t);
  const path = join(root, 'vault/卡片/基底.md');
  const crlf = (await readFile(path, 'utf8')).replace(/\r?\n/g, '\r\n').replace('基底给出坐标语言。', '第一行\r\n第二行');
  await writeFile(path, crlf);
  const result = await run(['write-batch', '--workspace', root], { input: JSON.stringify({ files: [{ op: 'edit', path: '卡片/基底.md', oldText: '第一行\n第二行', newText: '改后一\n改后二' }] }) });
  assert.equal(result.code, 0, JSON.stringify(result.json));
  const saved = await readFile(path, 'utf8');
  assert.match(saved, /改后一\r\n改后二/);
  assert.equal(saved.replace(/\r\n/g, '').includes('\n'), false);
});
test('the board, template and skill folders stay reserved however their names are written', async t => {
  const { root } = await workspace(t);
  for (const path of ['LESSON-BOARD/x.md', 'Lesson-Board/x.md', 'leſſon-board/x.md', '_TEMPLATES/x.md', '_Templates/y.md']) {
    const result = await run(['write-batch', '--workspace', root], { input: JSON.stringify({ files: [{ op: 'create', path, content: '# x\n' }] }) });
    assert.notEqual(result.code, 0, path);
    assert.match(JSON.stringify(result.json ?? result.errorJson), /board_path_reserved|vault_path_invalid/, path);
  }
});

test('a batch create refuses a name Windows cannot hold', async t => {
  const { root } = await workspace(t);
  const result = await run(['write-batch', '--workspace', root], { input: JSON.stringify({ files: [{ op: 'create', path: '卡片/第1题:斜率.md', content: '# x\n' }] }) });
  assert.equal(result.json.result.results[0].error.code, 'vault_path_not_portable');
});

test('batch edits reject missing or ambiguous original text and preserve external edits', async t => {
  const { root } = await workspace(t);
  const path = join(root, 'vault/卡片/基底.md');
  const changed = (await readFile(path, 'utf8')).replace('基底给出坐标语言。', '外部已经修改。\n重复\n重复\n');
  await writeFile(path, changed);
  for (const oldText of ['基底给出坐标语言。', '重复']) {
    const result = await run(['write-batch', '--workspace', root], { input: JSON.stringify({ files: [{ op: 'edit', path: '卡片/基底.md', oldText, newText: '不应该写入' }] }) });
    assert.equal(result.code, 1);
    assert.equal(result.json.result.results[0].error.code, 'batch_original_mismatch');
    assert.equal(await readFile(path, 'utf8'), changed);
  }
  const result = await run(['write-batch', '--workspace', root], { input: JSON.stringify({ files: [{ op: 'edit', path: '卡片/基底.md', oldText: '外部已经修改。', newText: '核对后的修改。' }] }) });
  assert.equal(result.code, 0);
  assert.equal(await readFile(path, 'utf8'), changed.replace('外部已经修改。', '核对后的修改。'));
});

test('invalid batch branches fail before any writes; batches can exceed ordinary CLI stdin limit', async t => {
  const { root } = await workspace(t);
  const first = { op: 'create', path: '卡片/不能提前写.md', content: '# 一\n' };
  for (const second of [
    { op: 'create', path: '卡片/混合.md', content: '# 二', oldText: '旧' },
    { op: 'edit', path: '卡片/基底.md', oldText: '', newText: '新' },
    { op: 'edit', path: '../越界.md', oldText: '旧', newText: '新' },
    { op: 'create', path: '卡片/身份.md', content: '# 二', sessionId: 'fake' },
  ]) {
    const result = await run(['write-batch', '--workspace', root], { input: JSON.stringify({ files: [first, second] }) });
    assert.equal(result.code, 2);
    await assert.rejects(readFile(join(root, 'vault/卡片/不能提前写.md')), /ENOENT/);
  }
  const content = '# 完整资料\n' + '内容。'.repeat(10000);
  const large = await run(['write-batch', '--workspace', root], { input: JSON.stringify({ files: [{ ...first, content }] }) });
  assert.equal(large.code, 0);
  assert.equal(await readFile(join(root, 'vault', first.path), 'utf8'), content);
});

test('the lesson board is written only by its own tool, never by a batch', async t => {
  const { root } = await workspace(t);
  const board = { op: 'create', path: 'lesson-board/0123456789abcdef0123456789abcdef.md', content: '# 板书\n' };
  const result = await run(['write-batch', '--workspace', root], { input: JSON.stringify({ files: [board] }) });
  assert.equal(result.code, 2);
  assert.match(result.out + result.err, /board_path_reserved/);
  await assert.rejects(readFile(join(root, 'vault', board.path)), /ENOENT/);
});

test('batch edit cannot overwrite a file changed between its read and native CAS write', async t => {
  const { root } = await workspace(t);
  const { Context } = await import('@deepseek-ai/cordis');
  const { LocalFileSystem } = await import('@deepseek-ai/dsh-fs-local');
  const { runCommand, validateArgs } = await import('./vault-cli.js');
  const fs = new LocalFileSystem(new Context(), { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 });
  const nativeWrite = fs.writeText.bind(fs);
  const path = join(root, 'vault/卡片/基底.md');
  const external = '# 别处刚保存的新内容\n';
  fs.writeText = async (...args) => {
    await writeFile(path, external);
    return nativeWrite(...args);
  };
  const args = validateArgs('write-batch', { files: [{ op: 'edit', path: '卡片/基底.md', oldText: '基底给出坐标语言。', newText: '过期的修改。' }] });
  const result = await runCommand('write-batch', args, { fs, root, env: {} });
  assert.equal(result.savedCount, 0);
  assert.equal(result.results[0].error.code, 'vault_revision_conflict');
  assert.equal(await readFile(path, 'utf8'), external);
});

test('工作区根的外层资料不会移动资料根：CLI 仍读写 vault/', async t => {
  const { root, revision } = await workspace(t);
  await writeFile(join(root, 'README.md'), '# 工作区说明\n');
  await mkdir(join(root, 'other'), { recursive: true });
  const env = { DSH_NOTARA_WORKSPACE: root, DSH_NOTARA_WORKSPACE_ID: 'cli-legacy', DSH_SESSION_ID: 'cli-legacy-session', DSH_NOTARA_CALL_ID: 'cli-legacy-call' };

  const queue = await run(['review-queue'], { env, input: '{"status":"all"}' });
  assert.equal(queue.code, 0);
  assert.deepEqual(queue.json.result.hits.map(hit => hit.path), ['卡片/基底.md']);

  const recorded = await run(['record-review'], { env, input: JSON.stringify({ path: '卡片/基底.md', expectedRevision: revision, ...judged, note: '旧布局仍读写 vault/。' }) });
  assert.equal(recorded.code, 0);
  assert.equal(recorded.json.result.actor, 'teacher');
  assert.match(await readFile(join(root, 'vault', '卡片', '基底.md'), 'utf8'), /review_history:/);
  assert.equal(await exists(join(root, '卡片')), false, '资料没有写进工作区根');
});

test('用户直接选中的资料目录即使残留旧版空 vault/ 也直接读写自己', async t => {
  const root = await mkdtemp(join(tmpdir(), 'notara-vault-cli-direct-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(root, { recursive: true, force: true }); });
  const card = '---\ntype: card\ntitle: 基底\ntags: [math]\n---\n\n基底给出坐标语言。\n';
  await mkdir(join(root, '卡片'), { recursive: true });
  await writeFile(join(root, '卡片', '基底.md'), card);
  // 旧版本在用户选中目录里留下的空 vault/ 与自动模板。
  await mkdir(join(root, 'vault', '_templates'), { recursive: true });
  await writeFile(join(root, 'vault', '_templates', 'card.md'), '# {{title}}\n');
  const revision = createHash('sha256').update(card, 'utf8').digest('hex').slice(0, 24);
  const env = { DSH_NOTARA_WORKSPACE: root, DSH_NOTARA_WORKSPACE_ID: 'cli-direct', DSH_SESSION_ID: 'cli-direct-session', DSH_NOTARA_CALL_ID: 'cli-direct-call' };

  const queue = await run(['review-queue'], { env, input: '{"status":"all"}' });
  assert.equal(queue.code, 0);
  assert.deepEqual(queue.json.result.hits.map(hit => hit.path), ['卡片/基底.md']);
  assert.equal(queue.json.result.workspaceId, 'cli-direct');

  const recorded = await run(['record-review'], { env, input: JSON.stringify({ path: '卡片/基底.md', expectedRevision: revision, ...judged, note: '直接目录记录。' }) });
  assert.equal(recorded.code, 0);
  assert.match(await readFile(join(root, '卡片', '基底.md'), 'utf8'), /review_history:/);
  assert.equal(await exists(join(root, 'vault', '卡片')), false, '资料没有写进旧版误建的 vault/');
});

test('the teacher drafts skills through skill-save; skill files are never batch-written', async t => {
  const { root } = await workspace(t);
  const home = join(root, 'dsh-home');
  const env = { DSH_HOME: home };
  const content = (id, body) => `---\ntype: skill\nid: ${id}\ntitle: 解析几何要点\ndescription: 本学习集解析几何的逐步沉淀要点。\nstatus: draft\n---\n${body}\n`;
  const batch = await run(['write-batch', '--workspace', root], { input: JSON.stringify({ files: [{ op: 'create', path: '技能/conic.md', content: content('conic', '# 要点') }] }) });
  assert.equal(batch.code, 2);
  assert.match(batch.out + batch.err, /skill_path_reserved/);

  const created = await run(['skill-save', '--workspace', root], { input: JSON.stringify({ scope: 'set', content: content('conic', '# 要点\n圆过定点时可考虑反演。') }), env });
  assert.equal(created.code, 0, created.err);
  assert.equal(created.json.result.status, 'draft');
  assert.equal(await readFile(join(root, 'vault', '技能', 'conic.md'), 'utf8'), content('conic', '# 要点\n圆过定点时可考虑反演。'));
  const refused = await run(['skill-save', '--workspace', root], { input: JSON.stringify({ scope: 'set', content: content('conic', '# 改').replace('status: draft', 'status: active'), expectedRevision: created.json.result.revision }), env });
  assert.notEqual(refused.code, 0);
  assert.match(refused.out + refused.err, /skill_status_reserved/);

  const shared = await run(['skill-save', '--workspace', root], { input: JSON.stringify({ scope: 'global', content: content('analog-circuits', '# 模电核心') }), env });
  assert.equal(shared.code, 0, shared.err);
  assert.ok((await readFile(join(home, 'notara-skills', 'analog-circuits.md'), 'utf8')).includes('# 模电核心'));

  const listed = await run(['skill-list', '--workspace', root], { input: '{}', env });
  assert.deepEqual(listed.json.result.skills.map(row => `${row.scope}:${row.id}:${row.status}`).sort(), ['global:analog-circuits:draft', 'set:conic:draft']);
  assert.ok(listed.json.result.skills.every(row => !('body' in row)), 'the list carries no bodies');
  const read = await run(['skill-read', '--workspace', root], { input: JSON.stringify({ scope: 'set', id: 'conic' }), env });
  assert.match(read.json.result.content, /反演/);
  assert.equal(read.json.result.revision, created.json.result.revision);
  assert.equal(read.json.result.pending, null);

  const noHome = await run(['skill-save', '--workspace', root], { input: JSON.stringify({ scope: 'global', content: content('other', '# x') }), env: { DSH_HOME: '' } });
  assert.notEqual(noHome.code, 0);
  assert.match(noHome.out + noHome.err, /skill_scope_unavailable/);
});

/** A real PDF of blank pages, built here so the test needs no binary fixture. */
function blankPdf(pages) {
  const kids = Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(' ');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`, ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>')];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => { const at = Buffer.byteLength(body, 'latin1'); body += `${index + 1} 0 obj\n${object}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

test('source-cards finds the cards lifted from a material by where they cite it, never by file name', async t => {
  const root = await mkdtemp(join(tmpdir(), 'notara-vault-cli-sources-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(root, { recursive: true, force: true }); });
  const vault = join(root, 'vault'), pdf = blankPdf(4), current = createHash('sha256').update(pdf).digest('hex').slice(0, 24);
  const card = (body, extra = '') => `---\ntype: card\n${extra}---\n${body}\n`;
  const files = {
    '媒体/讲义.pdf': pdf,
    '媒体/课.mp4': Buffer.from('not really a video'),
    '知识/讲义.md': '---\ntype: source\n---\n# 讲义\n\n![[媒体/讲义.pdf#page=1]]\n',
    '卡片/专题.md': '---\ntype: topic\n---\n# 专题\n\n本专题来自 [[知识/讲义.md]]。\n',
    '卡片/摸球-区域引用.md': card(`# 摸球\n\n![[媒体/讲义.pdf#page=1&rect=0.1,0.2,0.8,0.2&revision=${current}]]`, 'parent: 卡片/专题.md\nlearned: true\nmastery: 1\ninterval: 1\nlast_review: 2026-09-27\nnext_review: 2026-09-28\n'),
    '卡片/第二页.md': card('# 第二页\n\n![[媒体/讲义.pdf#page=2&revision=aaaaaaaaaaaaaaaaaaaaaaaa]]'),
    '卡片/整份.md': card('# 整份\n\n![[媒体/讲义.pdf]]'),
    '卡片/坏页.md': card('# 坏页\n\n![[媒体/讲义.pdf#page=0]]'),
    '卡片/没出处.md': card('# 没出处\n\n手打的题目。', 'parent: 卡片/专题.md\n'),
    // Named like page 3 but citing nothing: a file name is not coverage.
    '卡片/讲义-03.md': card('# 讲义第 3 题\n\n只有名字像。'),
    // A plan page citing page 3 is a reference, not a card lifted from it.
    '备课/第三页.md': '---\ntype: lesson\n---\n# 备课\n\n![[媒体/讲义.pdf#page=3]]\n',
    '卡片/锚点.md': card('# 锚点\n\n![[知识/讲义.md#anchor=条件概率]]'),
    '卡片/中段.md': card('# 中段\n\n![[媒体/课.mp4#t=60000,120000]]'),
    '卡片/开头.md': card('# 开头\n\n![[媒体/课.mp4#t=0,30000]]'),
  };
  for (const [path, content] of Object.entries(files)) { await mkdir(join(vault, path, '..'), { recursive: true }); await writeFile(join(vault, path), content); }

  const note = await run(['source-cards', '--workspace', root], { input: JSON.stringify({ path: '知识/讲义.md' }) });
  assert.equal(note.code, 0, note.out + note.err);
  const result = note.json.result;
  // A material page is checked together with the PDF it embeds.
  assert.deepEqual(result.targets.map(target => [target.path, target.kind]), [['知识/讲义.md', 'page'], ['媒体/讲义.pdf', 'pdf']]);
  assert.deepEqual(result.targets[0].anchors, [{ anchor: '条件概率', cards: ['卡片/锚点.md'] }]);
  const [, book] = result.targets;
  assert.equal(book.pageCount, 4);
  assert.equal(book.revision, current);
  assert.deepEqual(book.pages, [
    { page: 1, cards: [{ path: '卡片/摸球-区域引用.md', rect: [0.1, 0.2, 0.8, 0.2] }] },
    // Pinned to an older version: still this material, marked, not a gap.
    { page: 2, cards: [{ path: '卡片/第二页.md', otherRevision: 'aaaaaaaaaaaaaaaaaaaaaaaa' }] },
  ]);
  assert.deepEqual(book.uncoveredPages, [3, 4], 'neither the plan page nor a look-alike file name covers page 3');
  assert.deepEqual(book.wholeFile, ['卡片/整份.md']);
  assert.deepEqual(book.invalid, ['卡片/坏页.md']);
  assert.equal(result.cards.some(item => item.path === '卡片/讲义-03.md'), false);
  assert.deepEqual(result.cards.find(item => item.path === '卡片/摸球-区域引用.md').state, { learned: true, mastery: 1, interval: 1, last_review: '2026-09-27', next_review: '2026-09-28' });
  // The topic citing this material lists a child with no citation: read that one.
  assert.deepEqual(result.materials, [{ path: '卡片/专题.md', title: '专题', type: 'topic', uncitedCards: ['卡片/没出处.md'] }]);

  const selected=await run(['source-cards','--workspace',root],{input:JSON.stringify({path:'知识/讲义.md',pageRange:[2,3]})});
  assert.equal(selected.code,0,selected.err);
  const selectedPdf=selected.json.result.targets.find(target=>target.kind==='pdf');
  assert.equal(selectedPdf.pageCount,4);
  assert.deepEqual(selectedPdf.pageRange,[2,3]);
  assert.deepEqual(selectedPdf.pages,[book.pages[1]]);
  assert.deepEqual(selectedPdf.uncoveredPages,[3]);
  assert.equal(selected.json.result.cards.some(card=>card.path==='卡片/摸球-区域引用.md'),false);
  assert.deepEqual(selected.json.result.materials,result.materials,'a citation outside this range is not a missing citation');
  const badRange=await run(['source-cards','--workspace',root],{input:JSON.stringify({path:'媒体/讲义.pdf',pageRange:[2,5]})});
  assert.equal(badRange.errorJson.error.code,'pdf_page_invalid');
  const noOutline=await run(['pdf-outline','--workspace',root],{input:JSON.stringify({path:'媒体/讲义.pdf'})});
  assert.equal(noOutline.code,0,noOutline.err);
  assert.equal(noOutline.json.result.pageCount,4);
  assert.deepEqual(noOutline.json.result.items,[]);
  assert.deepEqual(noOutline.json.result.warnings,['pdf_outline_missing']);

  const video = await run(['source-cards', '--workspace', root], { input: JSON.stringify({ path: '媒体/课.mp4' }) });
  assert.deepEqual(video.json.result.targets, [{ path: '媒体/课.mp4', kind: 'video', ranges: [{ path: '卡片/开头.md', startMs: 0, endMs: 30000 }, { path: '卡片/中段.md', startMs: 60000, endMs: 120000 }], wholeFile: [], invalid: [] }]);

  const missing = await run(['source-cards', '--workspace', root], { input: JSON.stringify({ path: '媒体/没有.pdf' }) });
  assert.notEqual(missing.code, 0);
  assert.match(missing.out + missing.err, /vault_file_not_found/);
});

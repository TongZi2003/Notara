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
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const CLI = fileURLToPath(new URL('./vault-cli.js', import.meta.url));
const assessments = [{ ability: '解释基底的作用', outcome: 'demonstrated' }];

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
  assert.deepEqual(Object.keys(top.json.commands).sort(), ['calendar', 'create-route', 'lesson-log', 'lesson-outline', 'lesson-section', 'pdf-page', 'record-review', 'review-queue', 'revise-route', 'route-outline', 'schedule-lesson', 'undo-review', 'write-batch']);

  const command = await run(['record-review', '--help']);
  assert.equal(command.code, 0);
  assert.equal(command.json.stdin.additionalProperties, false);
  for (const key of ['path', 'expectedRevision', 'assessments', 'note']) assert.ok(command.json.stdin.fields[key], `record-review schema must document ${key}`);
  assert.equal(command.json.stdin.fields.passed, undefined);
  assert.ok(command.json.rejects.includes('sessionId'));
  assert.ok(command.json.example.includes('assessments'));
});

test('the schema rejects identity and unknown fields before touching any file', async t => {
  const { root, revision } = await workspace(t);
  const env = { DSH_NOTARA_WORKSPACE: root, DSH_NOTARA_WORKSPACE_ID: 'cli-test', DSH_SESSION_ID: 'cli-session' };

  const identity = await run(['record-review'], { env, input: JSON.stringify({ path: '卡片/基底.md', expectedRevision: revision, assessments, note: '好', sessionId: 'forged' }) });
  assert.equal(identity.code, 2);
  assert.equal(identity.errorJson.error.code, 'cli_field_unknown');
  assert.equal(identity.errorJson.error.field, 'sessionId');

  const recordDate = await run(['record-review'], { env, input: JSON.stringify({ path: '卡片/基底.md', expectedRevision: revision, assessments, note: '好', date: '2026-09-22' }) });
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

test('standalone --workspace is the only explicit path, and records as actor self', async t => {
  const { root, revision } = await workspace(t);
  const env = { DSH_NOTARA_WORKSPACE: '', DSH_NOTARA_WORKSPACE_ID: '', DSH_SESSION_ID: '', DSH_NOTARA_CALL_ID: '' };

  const queue = await run(['review-queue', '--workspace', root], { env, input: '{"status":"all"}' });
  assert.equal(queue.code, 0);
  assert.equal(queue.json.result.hits[0].path, '卡片/基底.md');
  assert.equal(queue.json.result.standalone, true);

  const recorded = await run(['record-review', '--workspace', root], { env, input: JSON.stringify({ path: '卡片/基底.md', expectedRevision: revision, assessments, note: '能自己解释基底的作用。' }) });
  assert.equal(recorded.code, 0);
  assert.equal(recorded.json.result.actor, 'self');
  assert.equal(recorded.json.result.sessionId, null);
  assert.equal(recorded.json.result.state.mastery, 1);
  assert.match(await readFile(join(root, 'vault/卡片/基底.md'), 'utf8'), /review_history:/);
});

test('CLI records unknown without a schedule, preserves evidence, enforces CAS and supports undo', async t => {
  const { root, revision } = await workspace(t);
  const { parseFrontmatter } = await import('./frontmatter.js');
  const path = join(root, 'vault/卡片/基底.md');
  const args = { path: '卡片/基底.md', expectedRevision: revision, assessments: [{ ability: '自主选基底', outcome: 'not_observed' }], note: '老师给出基底，学生完成坐标计算，选基底尚未观察。' };
  const result = await run(['record-review', '--workspace', root], { input: JSON.stringify(args) });
  assert.equal(result.code, 0);
  assert.equal(result.json.result.scheduleChanged, false);
  assert.equal(result.json.result.state.learned, false);
  const saved = await readFile(path, 'utf8');
  const fields = parseFrontmatter(saved).frontmatter;
  assert.deepEqual(fields.review_history[0].assessments, args.assessments);
  assert.equal(fields.review_history[0].actor, 'self');
  const stale = await run(['record-review', '--workspace', root], { input: JSON.stringify({ ...args, assessments }) });
  assert.notEqual(stale.code, 0);
  assert.equal(await readFile(path, 'utf8'), saved);
  const oldWrite = await run(['record-review', '--workspace', root], { input: JSON.stringify({ ...args, expectedRevision: result.json.result.revision, passed: true }) });
  assert.equal(oldWrite.code, 2);
  assert.equal(oldWrite.errorJson.error.field, 'passed');
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

test('assessment errors identify the repair field and Unicode note limits match the writer', async t => {
  const { root, revision } = await workspace(t);
  const args = { path: '卡片/基底.md', expectedRevision: revision, assessments, note: '💡'.repeat(2100) };
  const invalid = await run(['record-review', '--workspace', root], { input: JSON.stringify({ ...args, assessments: [assessments[0], assessments[0]] }) });
  assert.equal(invalid.errorJson.error.code, 'review_assessments_invalid');
  assert.equal(invalid.errorJson.error.field, 'assessments');
  const valid = await run(['record-review', '--workspace', root], { input: JSON.stringify(args) });
  assert.equal(valid.code, 0);
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

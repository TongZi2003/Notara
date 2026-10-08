import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import { createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import { NotaraContextHistory } from './context-history.js';
import { ContextHistoryClient } from './context-history-client.js';
import { prepareNativeEventRecord } from './context-history-record.js';
import { historySearchReceipt } from './context-history-tools.js';
import { NATIVE_HISTORY_SEARCH_POLICY } from './context-history-search-policy.js';

const policy = NATIVE_HISTORY_SEARCH_POLICY;
const sha = value => createHash('sha256').update(value).digest('hex');
const encodedString = value => JSON.stringify(value).slice(1, -1);
const text = value => ({ type: 'text', text: value });
const user = (session, value) => session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [text(value)] }), { surfaceOp: 'append' });
const tool = (name, args, id = crypto.randomUUID()) => ({ type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) });
const assistant = (session, turn, calls, value = '') => session.append('assistant/message', {
  turn, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'synthetic-only', model: 'evidence-native-fixture' },
    content: [...(value ? [text(value)] : []), ...calls] }),
}, { surfaceOp: 'append' });
const call = (session, turn, block) => session.append('tool/call', { turn, step: 1, callId: block.id, name: block.name, arguments: block.arguments });
const result = (session, turn, id, value) => session.append('tool/result', { turn, step: 1,
  message: createToolResultMessage({ callId: ToolCallId(id), isError: false, content: [text(value)] }),
}, { surfaceOp: 'append' });
function begin(session, turn) { session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 }); }
function end(session, turn) { session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'stop' } }); }

// Every owner and SQLite path is synthetic. No Host, build, credentials, or user data.
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'notara-history-evidence-native-'));
  const path = join(dir, 'history.sqlite'), ctx = new Context(), fibers = [], histories = [], detaches = [], clients = [];
  fibers.push(await ctx.plugin(SessionStore), await ctx.plugin(SessionQueryEngine));
  t.after(async () => {
    for (const entry of histories) if (!entry.stopped) { await entry.history.close(); await entry.fiber.dispose(); }
    for (const client of clients) await client.close();
    for (const detach of detaches.reverse()) detach();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir())); assert.ok(basename(target).startsWith('notara-history-evidence-native-'));
    await rm(target, { recursive: true, force: true });
  });
  return { ctx, path,
    session(id = `evidence-${crypto.randomUUID()}`) {
      const session = ctx.sessions.prepare(SessionId(id), { meta: { cwd: dir } });
      detaches.push(ctx.sessions.enter(session)); ctx.sessions.announce(session); return session;
    },
    client() { const client = new ContextHistoryClient({ path }); clients.push(client); return client; },
    async history() {
      const fiber = await ctx.plugin(NotaraContextHistory, { path }), history = ctx.notaraHistory;
      histories.push({ history, fiber, stopped: false }); return history;
    },
    async stop(history) {
      const entry = histories.find(row => row.history === history);
      await history.close(); await entry.fiber.dispose(); entry.stopped = true;
    },
  };
}
async function raw(history, owner, seq, { checkPolicy = true } = {}) {
  let afterPart = -1, body = '', event, parts = 0;
  const ranges = [];
  for (;;) {
    const page = await history.page(owner, { seq, afterPart }); event ??= page.event;
    for (const row of page.rows) {
      assert.equal(row.part, parts++); assert.equal(row.start, body.length); assert.equal(row.end, row.start + row.body.length);
      ranges.push({ part: row.part, start: row.start, end: row.end });
      assert.ok(row.body.length <= 8192); body += row.body;
    }
    if (page.done) break;
    afterPart = page.rows.at(-1).part;
  }
  assert.equal(body.length, event.chars); assert.equal(Buffer.byteLength(body), event.bytes); assert.equal(sha(body), event.hash);
  if (checkPolicy) assert.equal(event.search.policy, policy);
  return { body, event, record: JSON.parse(body), parts, ranges };
}
async function literal(history, owner, source, query, { start } = {}) {
  const archived = await raw(history, owner, source.seq, { checkPolicy: false }), expected = encodedString(query);
  const response = await history.search(owner, { query }), receipt = historySearchReceipt(response, query);
  const found = response.results.filter(row => row.seq === source.seq && row.hitKind === 'query-literal');
  assert.ok(found.length, `missing encoded literal ${JSON.stringify(query)}`);
  for (const row of found) {
    assert.ok(Number.isSafeInteger(row.hitStart) && Number.isSafeInteger(row.hitEnd));
    assert.equal(archived.body.slice(row.hitStart, row.hitEnd), expected);
    assert.equal(row.hitEnd - row.hitStart, expected.length);
    assert.ok(row.windowStart <= row.hitStart && row.windowEnd >= row.hitEnd);
    const originPart = archived.ranges.find(range => range.start <= row.hitStart && row.hitStart < range.end)?.part;
    assert.equal(row.part, originPart, 'read cursor anchors the part containing the original hit start');
    assert.ok(row.ref.endsWith(`:${source.seq}:${originPart}`));
    const toolHit = receipt.hits.find(hit => hit.seq === row.seq && hit.hitStart === row.hitStart && hit.hitEnd === row.hitEnd);
    assert.ok(toolHit, 'the teacher receipt contains the raw evidence span');
    assert.equal(toolHit.read.afterPart, originPart - 1);
    const readPage = await history.page(owner, toolHit.read);
    assert.equal(readPage.rows[0].part, originPart);
    const readBody = readPage.rows.map(chunk => chunk.body).join(''), localStart = row.hitStart - readPage.rows[0].start;
    assert.equal(readBody.slice(localStart, localStart + expected.length), expected, 'the returned read cursor retrieves the full encoded evidence');
    if (start !== undefined) assert.equal(row.hitStart, start);
  }
  assert.equal(archived.event.search.policy, policy);
  return { ...archived, found };
}

test('actual native controls delimit a following identifier without escape-letter postings', async t => {
  const f = await fixture(t), history = await f.history();
  for (const control of ['\n', '\t', '\r', '\b', '\f', '\u0000', '\u001f']) {
    const owner = f.session(), marker = 'native_control_marker_319748', original = `题目${control}${marker}`;
    const source = user(owner, original), stored = await literal(history, owner, source, marker);
    assert.equal(stored.record.blocks[0].text, original);
    const polluted = `${encodedString(control).slice(1)}${marker}`;
    assert.deepEqual((await history.search(owner, { query: polluted })).results, [], 'an encoding mnemonic is not source evidence');
  }
});

test('Chinese multiline original returns the entire encoded query and UTF16 range', async t => {
  const f = await fixture(t), owner = f.session(), history = await f.history();
  const query = '抛物线😀顶点\n第二行：坐标为（2，3）', original = `学生原稿：\n${query}\n原稿结束`;
  const source = user(owner, original), stored = await literal(history, owner, source, query);
  assert.equal(stored.record.blocks[0].text, original);
  assert.equal(stored.found[0].hitStart, stored.body.indexOf(encodedString(query)));
});

test('quotes, paths, and LaTex literal backslashes retain their complete canonical ranges', async t => {
  const f = await fixture(t), history = await f.history();
  for (const query of ['"quoted_marker_583947"', String.raw`E:\Notara\native-note.txt`,
    String.raw`\frac{1}{2}`, String.raw`\nabla f`, String.raw`\text{他说 "可以"}`,
    String.raw`第一行 \\ 第二行`]) {
    const owner = f.session(), original = `原始公式： ${query} 公式结束`, source = user(owner, original);
    const stored = await literal(history, owner, source, query);
    assert.equal(stored.found[0].hitStart, stored.body.indexOf(encodedString(query)));
    assert.equal(stored.record.blocks[0].text, original);
  }
});

test('decimal numeric anchors recall the original and reject split-number candidate lookalikes', async t => {
  const f = await fixture(t), owner = f.session(), history = await f.history();
  const source = user(owner, '原始测量记录：绿色标签，0.037厘米。');
  user(owner, '分拆数字：0 037厘米；另一小数0.073。');
  owner.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [text('0.'), text('037厘米')] }), { surfaceOp: 'append' });
  user(owner, '编码控制符：\u0000，不能把转义数字当成原文字面值。');
  const stored = await literal(history, owner, source, '0.037');
  const response = await history.search(owner, { query: '0.037' });
  assert.deepEqual([...new Set(response.results.map(row => row.seq))], [source.seq]);
  assert.ok(response.diagnostics.queryTerms > 0 && response.diagnostics.candidates > 1,
    'candidate superset is narrowed by complete encoded source-span verification');
  assert.equal(stored.record.blocks[0].text, source.data.content[0].text);
  assert.deepEqual((await history.search(owner, { query: '0000' })).results, []);
});

test('pure digits and substrings of long numbers retain exact encoded spans and bounded search', async t => {
  const f = await fixture(t), owner = f.session(), history = await f.history();
  const long = '314159265358979323846'.repeat(24).slice(0, 512);
  const source = user(owner, `原始编号314159，长编号${long}。`);
  user(owner, '编号拆开：314 159，邻近错误编号314195。');
  for (const query of ['314159', '4159', long]) {
    const stored = await literal(history, owner, source, query);
    const response = await history.search(owner, { query });
    assert.deepEqual([...new Set(response.results.map(row => row.seq))], [source.seq]);
    assert.ok(response.results.every(row => row.hitKind === 'query-literal'));
    assert.ok(response.diagnostics.queryTerms <= 110 && response.results.length <= 10);
    assert.equal(stored.record.blocks[0].text, source.data.content[0].text);
  }
});

test('a rejected projection lookalike does not hide the later true newline literal', async t => {
  const f = await fixture(t), owner = f.session(), history = await f.history();
  const query = '\nreal_pattern_marker_247193', original = `  real_pattern_marker_247193 后方${query}`;
  const source = user(owner, original), prepared = await prepareNativeEventRecord(source), body = [...prepared.chunks()].join('');
  const stored = await literal(history, owner, source, query, { start: body.lastIndexOf(encodedString(query)) });
  assert.equal(stored.record.blocks[0].text, original);
});

test('a letter inside a newline escape cannot become the start of a source literal', async t => {
  const f = await fixture(t), owner = f.session(), history = await f.history();
  const query = 'nmarker_319748', original = '题目\nmarker_319748 nmarker_319748', source = user(owner, original);
  const prepared = await prepareNativeEventRecord(source), body = [...prepared.chunks()].join('');
  assert.notEqual(body.indexOf(query), body.lastIndexOf(query), 'fixture includes the historical false encoded occurrence');
  await literal(history, owner, source, query, { start: body.lastIndexOf(query) });
});

test('masked JSON framing between separate native text blocks cannot be claimed as source spaces', async t => {
  const f = await fixture(t), owner = f.session(), history = await f.history();
  const left = 'left_visible_marker_873249', right = 'right_visible_marker_315827';
  const source = owner.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [text(left), text(right)] }), { surfaceOp: 'append' });
  const prepared = await prepareNativeEventRecord(source), body = [...prepared.chunks()].join('');
  const gap = body.indexOf(right) - body.indexOf(left) - left.length, query = left + ' '.repeat(gap) + right;
  assert.ok(gap > 0); assert.ok(query.length < 512); assert.ok(!body.includes(encodedString(query)));
  const response = await history.search(owner, { query });
  assert.ok(response.results.length, 'both native words remain lexical candidates');
  assert.ok(response.results.every(row => row.hitKind !== 'query-literal'), 'masked framing is not an exact source query');
  const stored = await raw(history, owner, source.seq);
  assert.deepEqual(stored.record.blocks.map(block => block.text), [left, right]);
});

test('ten thousand backslashes and a 512-character query spanning 8192 retain bounded raw chunks', async t => {
  const f = await fixture(t), owner = f.session(), history = await f.history();
  const baseline = user(owner, ''), baseRecord = await prepareNativeEventRecord(baseline);
  const baseBody = [...baseRecord.chunks()].join(''), contentStart = baseBody.indexOf('"text":"') + '"text":"'.length;
  const query = '\u0000'.repeat(255) + 'marker_319748' + '\u0000'.repeat(244);
  assert.equal(query.length, 512); assert.ok(encodedString(query).length > 2 * 512);
  const desiredStart = 3 * 8192 - 1500, padding = desiredStart - contentStart - 2 * 10000;
  assert.ok(padding > 0);
  const original = '\\'.repeat(10000) + '甲'.repeat(padding) + query + '\nlong_slash_tail_619473';
  const source = user(owner, original), stored = await literal(history, owner, source, query, { start: desiredStart });
  assert.ok(stored.parts >= 4); assert.equal(stored.record.blocks[0].text, original);
  await literal(history, owner, source, 'long_slash_tail_619473');
});

test('mixed assistant and ordinary tools survive normalization while history arguments and receipts stay masked', async t => {
  const f = await fixture(t), owner = f.session(), history = await f.history();
  begin(owner, 1);
  const lookup = tool('history_search', { query: 'hidden_history_marker_491728' }), ordinary = tool('vault_read', { path: 'ordinary_path_marker_348291' });
  const mixedText = '真实说明\nvisible_assistant_marker_842913', mixed = assistant(owner, 1, [lookup, ordinary], mixedText);
  const searched = call(owner, 1, lookup), hidden = result(owner, 1, lookup.id, '回显\nhidden_history_marker_491728');
  const ordinaryCall = call(owner, 1, ordinary), ordinaryText = '实际工具原文\nordinary_result_marker_148392';
  const ordinaryResult = result(owner, 1, ordinary.id, ordinaryText); end(owner, 1);
  await literal(history, owner, mixed, 'visible_assistant_marker_842913');
  await literal(history, owner, ordinaryCall, 'ordinary_path_marker_348291');
  await literal(history, owner, ordinaryResult, ordinaryText);
  assert.deepEqual((await history.search(owner, { query: 'hidden_history_marker_491728' })).results, []);
  assert.equal((await raw(history, owner, mixed.seq)).record.blocks[1].arguments, lookup.arguments);
  assert.equal((await raw(history, owner, searched.seq)).record.arguments, lookup.arguments);
  assert.equal((await raw(history, owner, hidden.seq)).record.blocks[0].text, '回显\nhidden_history_marker_491728');
  assert.equal((await raw(history, owner, ordinaryResult.seq)).record.blocks[0].text, ordinaryText);
  for (let turn = 2; turn <= 21; turn++) {
    begin(owner, turn);
    const read = tool('history_read', { seq: mixed.seq }); assistant(owner, turn, [read]); call(owner, turn, read);
    result(owner, turn, read.id, mixedText); end(owner, turn);
  }
  const afterEcho = await literal(history, owner, mixed, 'visible_assistant_marker_842913');
  assert.deepEqual([...new Set(afterEcho.found.map(row => row.seq))], [mixed.seq]);
  assert.deepEqual((await history.search(owner, { query: 'hidden_history_marker_491728' })).results, []);
});

test('restart reuses the current policy scope and preserves exact hashes, bytes, offsets, and masked receipts', async t => {
  const f = await fixture(t), owner = f.session(), first = await f.history();
  const query = '重启😀原文\n"restart_marker_832194" ' + String.raw`\nabla f`, source = user(owner, query);
  begin(owner, 1); const lookup = tool('history_search', { query: 'restart_hidden_marker_593182' });
  assistant(owner, 1, [lookup]); call(owner, 1, lookup); const receipt = result(owner, 1, lookup.id, query); end(owner, 1);
  const before = await literal(first, owner, source, query), rawReceipt = await raw(first, owner, receipt.seq), scope = await first.ensure(owner);
  await f.stop(first); const next = await f.history(), reused = await next.ensure(owner);
  assert.equal(reused.scope, scope.scope); assert.equal(reused.generation, scope.generation);
  const after = await literal(next, owner, source, query);
  assert.equal(after.body, before.body); assert.equal(after.event.hash, before.event.hash);
  assert.equal(after.event.search.hash, before.event.search.hash);
  assert.equal((await raw(next, owner, receipt.seq)).body, rawReceipt.body);
  assert.deepEqual((await next.search(owner, { query: 'restart_hidden_marker_593182' })).results, []);
  assert.deepEqual([...new Set((await next.search(owner, { query })).results.map(row => row.seq))], [source.seq]);
});

async function installV1Metadata(path, scope, seq, body, original) {
  const payload = encodedString(original), start = body.indexOf(payload);
  assert.ok(start >= 0);
  const projection = ' '.repeat(start) + payload + ' '.repeat(body.length - start - payload.length);
  const search = JSON.stringify({ policy: 'native-evidence-v1', hash: sha(projection) });
  // Old-policy metadata, original mask, and postings are installed only in a test Worker.
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    (async () => {
      const { indexTerms } = await import(workerData.storeUrl);
      const db = new DatabaseSync(workerData.path);
      try {
      db.prepare('UPDATE events SET search=? WHERE scope=? AND seq=?').run(workerData.search,workerData.scope,workerData.seq);
      db.prepare('DELETE FROM postings WHERE scope=?').run(workerData.scope);
      db.prepare('DELETE FROM termStats WHERE scope=?').run(workerData.scope);
      for (const row of db.prepare('SELECT id,start,end FROM chunks WHERE scope=? AND seq=?').all(workerData.scope,workerData.seq))
        db.prepare('UPDATE chunks SET search=? WHERE id=?').run(workerData.projection.slice(row.start,row.end),row.id);
      const id = db.prepare('SELECT id FROM chunks WHERE scope=? AND seq=? AND part=0').get(workerData.scope,workerData.seq).id;
      for (const term of indexTerms(workerData.projection)) {
        db.prepare('INSERT INTO postings(scope,term,chunkId,seq) VALUES (?,?,?,?)').run(workerData.scope,term,id,workerData.seq);
        db.prepare('INSERT INTO termStats(scope,term,df) VALUES (?,?,1)').run(workerData.scope,term);
      }
      parentPort.postMessage('done');
      } finally { db.close(); }
    })().catch(error => { throw error; });
  `, { eval: true, workerData: { path, scope, seq, projection, search, storeUrl: new URL('./context-history-store.js', import.meta.url).href } });
  try { await new Promise((resolvePromise, reject) => {
    worker.once('message', value => value === 'done' ? resolvePromise() : reject(new Error('fixture worker failed')));
    worker.once('error', reject); worker.once('exit', code => { if (code) reject(new Error(`fixture worker exited ${code}`)); });
  }); } finally { await worker.terminate(); }
}

test('an existing v2 mask binding rebuilds missing numeric postings without changing canonical bytes', async t => {
  const f = await fixture(t), owner = f.session(), client = f.client();
  const source = user(owner, '原始测量记录：绿色标签，0.037厘米，编号314159。'), record = await prepareNativeEventRecord(source);
  const header = owner.header;
  const oldHash = sha(JSON.stringify(['notara-native-history-v1', 'native-event-v1', 'native-evidence-v2',
    header.version, header.id, header.createdAt, header.cwd ?? null, header.parentSession ?? null,
    header.isSeeded, header.origin ?? null, header.delegationDepth ?? null, header.agentPreset ?? null, owner.inheritedEventCount]));
  const old = await client.bindSession(owner.id, oldHash);
  let state = await client.beginEvent(old.scope, old.generation, record.metadata);
  for await (const batch of record.searchBatches()) state = await client.appendChunks(old.scope, old.generation, source.seq, state.offset, batch);
  await client.finishEvent(old.scope, old.generation, source.seq, state.parts);
  const oldBody = (await client.page(old.scope, old.generation, source.seq)).rows.map(row => row.body).join('');
  await client.close();
  // Recreate the actual preceding strategy: identical v2 escape projection,
  // persisted v2 descriptor/binding, and no numeric posting vocabulary.
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
    const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.path);
    try {db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE events SET search=? WHERE scope=? AND seq=?').run(workerData.search,workerData.scope,workerData.seq);
      db.prepare("DELETE FROM postings WHERE scope=? AND term LIKE 'n:%'").run(workerData.scope);
      db.prepare("DELETE FROM termStats WHERE scope=? AND term LIKE 'n:%'").run(workerData.scope);
      db.exec('COMMIT'); parentPort.postMessage('done');
    } finally {db.close();}`, { eval: true, workerData: { path: f.path, scope: old.scope, seq: source.seq,
      search: JSON.stringify({ ...record.metadata.search, policy: 'native-evidence-v2' }) } });
  try { await new Promise((accept, reject) => {
    worker.once('message', value => value === 'done' ? accept() : reject(new Error('old numeric fixture failed')));
    worker.once('error', reject); worker.once('exit', code => { if (code) reject(new Error(`old numeric worker exited ${code}`)); });
  }); } finally { await worker.terminate(); }
  const witness = f.client();
  assert.deepEqual((await witness.search(old.scope, old.generation, '0.037')).results, []);
  const history = await f.history(), current = await history.ensure(owner);
  assert.notEqual(current.scope, old.scope, 'numeric strategy revision invalidates the complete previous binding');
  for (const query of ['0.037', '314159']) {
    const rebuilt = await literal(history, owner, source, query);
    assert.equal(rebuilt.body, oldBody);
    assert.equal(rebuilt.event.hash, record.metadata.hash);
    assert.equal(rebuilt.event.search.hash, record.metadata.search.hash, 'numeric index revision does not change the v2 escape mask');
  }
  assert.equal((await witness.inspect(old.scope)).state, 'deleted');
  await assert.rejects(witness.page(old.scope, old.generation, source.seq));
  await assert.rejects(witness.beginEvent(current.scope, current.generation,
    { ...record.metadata, seq: source.seq + 1, search: { ...record.metadata.search, policy: 'native-evidence-unknown' } }),
  error => error.code === 'INVALID_SEARCH_METADATA');
});

test('an existing v1 policy binding rebuilds its index while raw history and permanent tombstones survive', async t => {
  const f = await fixture(t), owner = f.session(), deleted = f.session(), client = f.client();
  const original = '旧中文原文\nlegacy_control_marker_147392 ' + String.raw`\frac{1}{2}`, source = user(owner, original);
  const header = owner.header;
  const oldHash = sha(JSON.stringify(['notara-native-history-v1', 'native-event-v1', 'native-evidence-v1',
    header.version, header.id, header.createdAt, header.cwd ?? null, header.parentSession ?? null,
    header.isSeeded, header.origin ?? null, header.delegationDepth ?? null, header.agentPreset ?? null, owner.inheritedEventCount]));
  const old = await client.bindSession(owner.id, oldHash), record = await prepareNativeEventRecord(source);
  const { search: _currentPolicy, ...metadata } = record.metadata;
  let state = await client.beginEvent(old.scope, old.generation, metadata);
  for await (const batch of record.batches()) state = await client.appendChunks(old.scope, old.generation, source.seq, state.offset, batch);
  await client.finishEvent(old.scope, old.generation, source.seq, state.parts);
  const oldBody = (await client.page(old.scope, old.generation, source.seq)).rows.map(row => row.body).join('');
  await client.deleteSessionIds([deleted.id]); await client.close();
  await installV1Metadata(f.path, old.scope, source.seq, oldBody, original);
  const history = await f.history(), current = await history.ensure(owner);
  assert.notEqual(current.scope, old.scope);
  const rebuilt = await literal(history, owner, source, 'legacy_control_marker_147392');
  assert.equal(rebuilt.body, oldBody); assert.equal(rebuilt.record.blocks[0].text, original);
  const reopened = f.client(); assert.equal((await reopened.inspect(old.scope)).state, 'deleted');
  await assert.rejects(reopened.page(old.scope, old.generation, source.seq));
  await assert.rejects(history.ensure(deleted), error => error.code === 'SESSION_DELETED');
});

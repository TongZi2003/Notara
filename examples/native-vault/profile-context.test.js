import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '@deepseek-ai/dsh-session';
import { learnerProfileContext } from './profile-context.js';
import { profileOverview } from './learning-data.js';
import { parseMarkdownDocument } from './vault.js';

const profile = (text, path = '学情/数学.md') => parseMarkdownDocument(path, `---\ntype: learner-profile\ntitle: 数学\n---\n## 观察\n${text}\n## 学生原话\n这段不自动注入\n## 教学偏好\n先画图\n`);
const createSession = () => Session.create('profile-session', [], { version: 4, id: 'profile-session', createdAt: Date.now(), isSeeded: false, cwd: process.cwd(), agentPreset: 'notara-teacher' });
const scanOf = documents => ({ documents, errors: [], truncated: false });

test('profile overview keeps recent nested observations and has a total Unicode budget', () => {
  const first = profile('早期记录\n### 2026-10-01\n' + '😀'.repeat(2500) + '\n### 当前判断\n最新证据');
  const result = profileOverview([first]);
  assert.match(result.profiles[0].observed, /最新证据/);
  assert.doesNotMatch(result.profiles[0].observed, /早期记录|这段不自动注入/);
  assert.deepEqual(result.profiles[0].cut, ['观察']);
  const many = Array.from({length: 9}, (_, index) => profile('😀'.repeat(1500), `学情/${index}.md`));
  const full = profileOverview(many);
  assert.ok(Array.from(JSON.stringify(full)).length <= 4000);
  assert.ok(full.profiles.length <= 6);
  assert.equal(full.omitted, 9 - full.profiles.length);
  assert.throws(() => profileOverview([], {budget: NaN}), /profile_budget_invalid/);
});

test('profile snapshot and change notice survive reload without rewriting the snapshot', async () => {
  const session = createSession(), original = profile('最初观察'), changed = profile('更新后的观察');
  let flushes = 0;
  const args = {session, workspaceId: 'workspace', flush: async () => { flushes++; }};
  const first = await learnerProfileContext({...args, scan: scanOf([original])});
  assert.equal(first.length, 1);
  assert.match(first[0].text, /最初观察/);
  assert.equal(flushes, 1);
  assert.deepEqual(await learnerProfileContext({...args, scan: scanOf([original])}), first);
  assert.equal(flushes, 1);
  const next = await learnerProfileContext({...args, scan: scanOf([changed])});
  assert.equal(next[0].text, first[0].text);
  assert.equal(next[1].name, 'notara:profile-changed');
  assert.match(next[1].text, new RegExp(changed.revision));
  assert.equal(flushes, 2);
  // No module-level cache: a new caller sees the exact same durable contexts.
  assert.deepEqual(await learnerProfileContext({...args, scan: scanOf([changed])}), next);
  assert.equal(flushes, 2);
  session.append('user/message', {id: 'committed-context', role: 'user', source: {kind: 'runtime-context'}, content: [{type: 'text', text: next[1].text}]}, {surfaceOp: 'append'});
  assert.deepEqual(await learnerProfileContext({...args, scan: scanOf([changed])}), [first[0]], 'a committed notice is consumed, including after reconstruction');
  const deleted = await learnerProfileContext({...args, scan: scanOf([])});
  assert.match(deleted[1].text, /null/);
  assert.equal(deleted[0].text, first[0].text);
});

test('incomplete scans never record a missing profile; a branch gets its own current snapshot', async () => {
  const session = createSession(), old = profile('原课观察'), updated = profile('分支时观察');
  const args = {session, workspaceId: 'workspace', flush: async () => {}};
  const initial = await learnerProfileContext({...args, scan: scanOf([old])});
  const count = session.snapshotEvents().length;
  const incomplete = await learnerProfileContext({...args, scan: {...scanOf([]), truncated: true}});
  assert.equal(incomplete[0].text, initial[0].text);
  assert.equal(incomplete.at(-1).name, 'notara:profile-read-status');
  assert.equal(session.snapshotEvents().length, count);
  const fork = Session.create('profile-fork', session.snapshotEvents(), {...session.header, id: 'profile-fork', isSeeded: true}, count);
  const own = await learnerProfileContext({...args, session: fork, scan: scanOf([updated])});
  assert.match(own[0].text, /分支时观察/);
  assert.equal(own.length, 1);
});

test('undelivered profile changes accumulate across preparations, including a failed root scan',async()=>{
  const session=createSession(),first=profile('old A','学情/A.md'),second=profile('old B','学情/B.md');
  const args={session,workspaceId:'workspace',flush:async()=>{}};
  await learnerProfileContext({...args,scan:scanOf([first,second])});
  const updated=profile('new A','学情/A.md');
  await learnerProfileContext({...args,scan:scanOf([updated,second])});
  const failed=await learnerProfileContext({...args,scan:async()=>{throw new Error('EACCES');}});
  assert.equal(failed.at(-1).name,'notara:profile-read-status');
  const combined=await learnerProfileContext({...args,scan:scanOf([updated,profile('new B','学情/B.md')])});
  assert.match(combined[1].text,/学情\/A.md/);assert.match(combined[1].text,/学情\/B.md/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(learnerProfileContext({...args,signal:controller.signal,scan:async()=>{throw controller.signal.reason;}}),/abort/i);
});

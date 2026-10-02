import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  USER_SKILL_DIRECTORY, globalSkillRoot, parseUserSkill, readUserSkills, resolveSkillRevision, saveUserSkill, setUserSkillStatus, userSkillName,
} from './user-skills.js';

const skill = ({ id = 'analog-circuits', title = '模拟电子技术', description = '模电课：工作点、小信号模型与反馈。', status = 'draft', extra = '', body = '# 模拟电子技术\n\n## 主线\n\n先定工作点，再谈小信号。\n' } = {}) =>
  `---\ntype: skill\nid: ${id}\ntitle: ${title}\ndescription: ${description}\nstatus: ${status}\n${extra}---\n${body}`;

async function roots(t) {
  const base = await mkdtemp(join(tmpdir(), 'notara-user-skills-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return { set: join(base, 'vault', USER_SKILL_DIRECTORY), global: join(base, 'home', 'notara-skills'), base };
}

test('the two tiers live apart: the learning set in the Vault, discipline principles under DSH_HOME', () => {
  assert.equal(USER_SKILL_DIRECTORY, '技能');
  assert.equal(globalSkillRoot({ DSH_HOME: '/tmp/dsh-home' }), join('/tmp/dsh-home', 'notara-skills'));
  assert.equal(globalSkillRoot({}), null, 'no DSH_HOME, no shared tier: never the user\'s own ~/.dsh');
  assert.equal(userSkillName('set', 'circuits-course'), 'notara-set-circuits-course');
  assert.equal(userSkillName('global', 'analog-circuits'), 'notara-global-analog-circuits');
});

test('a skill file needs its type, a slug id matching the file, a title and a description', () => {
  const parsed = parseUserSkill('analog-circuits.md', skill());
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.id, 'analog-circuits');
  assert.equal(parsed.status, 'draft');
  assert.match(parsed.body, /先定工作点/);
  assert.doesNotMatch(parsed.body, /^---/);
  for (const [file, content, code] of [
    ['analog-circuits.md', skill().replace('type: skill', 'type: note'), 'skill_type_invalid'],
    ['Analog.md', skill({ id: 'Analog' }), 'skill_id_invalid'],
    ['other.md', skill(), 'skill_id_mismatch'],
    ['analog-circuits.md', skill({ title: '' }), 'skill_title_invalid'],
    ['analog-circuits.md', skill({ status: 'live' }), 'skill_status_invalid'],
    ['analog-circuits.md', 'no frontmatter', 'skill_type_invalid'],
  ]) assert.equal(parseUserSkill(file, content).error, code, code);
});

test('a new skill is always saved as a draft; asking to create it active is refused', async t => {
  const { set } = await roots(t);
  await assert.rejects(saveUserSkill(set, { content: skill({ status: 'active' }) }), /skill_status_reserved/);
  const saved = await saveUserSkill(set, { content: skill() });
  assert.deepEqual({ id: saved.id, status: saved.status, op: saved.op }, { id: 'analog-circuits', status: 'draft', op: 'create' });
  await assert.rejects(saveUserSkill(set, { content: skill() }), /skill_revision_required/);
  await assert.rejects(saveUserSkill(set, { content: skill({ body: '# 新版\n' }), expectedRevision: 'stale' }), /skill_revision_conflict/);
  const edited = await saveUserSkill(set, { content: skill({ body: '# 新版\n' }), expectedRevision: saved.revision });
  assert.equal(edited.op, 'edit');
  assert.match(await readFile(join(set, 'analog-circuits.md'), 'utf8'), /# 新版/);
});

test('only the student turns a draft on or off, and only against the version they saw', async t => {
  const { global } = await roots(t);
  const saved = await saveUserSkill(global, { content: skill() });
  await assert.rejects(setUserSkillStatus(global, { id: 'analog-circuits', status: 'active', expectedRevision: 'stale' }), /skill_revision_conflict/);
  const active = await setUserSkillStatus(global, { id: 'analog-circuits', status: 'active', expectedRevision: saved.revision });
  assert.equal(active.status, 'active');
  const [row] = await readUserSkills(global, 'global');
  assert.equal(row.status, 'active');
  assert.equal(row.name, 'notara-global-analog-circuits');
  const off = await setUserSkillStatus(global, { id: 'analog-circuits', status: 'draft', expectedRevision: row.revision });
  assert.equal(off.status, 'draft');
});

test('changing an active skill writes a revision to confirm and never touches the live text', async t => {
  const { set } = await roots(t);
  const saved = await saveUserSkill(set, { content: skill() });
  const live = await setUserSkillStatus(set, { id: 'analog-circuits', status: 'active', expectedRevision: saved.revision });
  const before = await readFile(join(set, 'analog-circuits.md'), 'utf8');
  const proposal = await saveUserSkill(set, { content: skill({ body: '# 模拟电子技术\n\n## 主线\n\n补充：负反馈的四种组态。\n' }), expectedRevision: live.revision });
  assert.equal(proposal.op, 'revision');
  assert.equal(await readFile(join(set, 'analog-circuits.md'), 'utf8'), before, 'the active text is unchanged');
  const [row] = await readUserSkills(set, 'set');
  assert.equal(row.status, 'active');
  assert.ok(row.pending, 'the list shows the pending revision');
  assert.match(row.pending.body, /四种组态/);
  // A second proposal edits the same pending revision against its own version.
  await assert.rejects(saveUserSkill(set, { content: skill({ body: '# 再改\n' }), expectedRevision: live.revision }), /skill_revision_conflict/);
  const again = await saveUserSkill(set, { content: skill({ body: '# 模拟电子技术\n\n补充：四种组态与稳定性。\n' }), expectedRevision: row.pending.revision });
  assert.equal(again.op, 'revision');
  // The revision it replaced, never adopted, stays recoverable.
  const kept = await readdir(join(set, '.trash')).catch(() => []);
  assert.equal(kept.length, 1);
  assert.match(await readFile(join(set, '.trash', kept[0]), 'utf8'), /负反馈的四种组态/);

  const [current] = await readUserSkills(set, 'set');
  const accepted = await resolveSkillRevision(set, { id: 'analog-circuits', action: 'accept', expectedRevision: current.pending.revision });
  assert.equal(accepted.status, 'active');
  const text = await readFile(join(set, 'analog-circuits.md'), 'utf8');
  assert.match(text, /四种组态与稳定性/);
  assert.match(text, /^status: active$/m);
  assert.doesNotMatch(text, /^revises:/m);
  const [after] = await readUserSkills(set, 'set');
  assert.equal(after.pending, undefined);
});

test('discarding a revision keeps it recoverable instead of deleting it', async t => {
  const { set } = await roots(t);
  const saved = await saveUserSkill(set, { content: skill() });
  const live = await setUserSkillStatus(set, { id: 'analog-circuits', status: 'active', expectedRevision: saved.revision });
  const proposal = await saveUserSkill(set, { content: skill({ body: '# 不要的修订\n' }), expectedRevision: live.revision });
  await resolveSkillRevision(set, { id: 'analog-circuits', action: 'discard', expectedRevision: proposal.revision });
  const [row] = await readUserSkills(set, 'set');
  assert.equal(row.pending, undefined);
  assert.doesNotMatch(await readFile(join(set, 'analog-circuits.md'), 'utf8'), /不要的修订/);
  const kept = await readdir(join(set, '.trash'));
  assert.equal(kept.length, 1);
});

test('broken files are listed with their reason and never offered to the teacher', async t => {
  const { set } = await roots(t);
  await mkdir(set, { recursive: true });
  await writeFile(join(set, 'broken.md'), skill({ id: 'broken', status: 'active' }).replace('title: 模拟电子技术\n', ''));
  await writeFile(join(set, 'notes.txt'), 'ignored');
  const rows = await readUserSkills(set, 'set');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].error, 'skill_title_invalid');
  assert.deepEqual(await readUserSkills(join(set, 'missing'), 'set'), []);
});

test('a new learning set inherits a skill as its own draft and records where it came from', async t => {
  const { inheritUserSkill } = await import('./user-skills.js');
  const { base } = await roots(t);
  const from = join(base, 'set-a', '技能'), to = join(base, 'set-b', '技能');
  const saved = await saveUserSkill(from, { content: skill({ id: 'conic-points', title: '解析几何要点' }) });
  await setUserSkillStatus(from, { id: 'conic-points', status: 'active', expectedRevision: saved.revision });
  const inherited = await inheritUserSkill(from, to, { id: 'conic-points', from: '高二数学' });
  assert.equal(inherited.status, 'draft');
  const text = await readFile(join(to, 'conic-points.md'), 'utf8');
  assert.match(text, /^status: draft$/m);
  assert.match(text, /^inherits: 高二数学\/conic-points$/m);
  assert.match(text, /先定工作点/);
  // The copy is independent: the source stays active and untouched.
  const [source] = await readUserSkills(from, 'set');
  assert.equal(source.status, 'active');
  await assert.rejects(inheritUserSkill(from, to, { id: 'conic-points', from: '高二数学' }), /skill_exists/);
  await assert.rejects(inheritUserSkill(from, to, { id: 'missing', from: '高二数学' }), /skill_not_found/);
});

test('a learning-set skill is served with a generated index of the 锦囊 it covers', async t => {
  const { skillContentWithInsights } = await import('./user-skills.js');
  const { base } = await roots(t);
  const vault = join(base, 'workspace');
  await mkdir(join(vault, '锦囊', '几何'), { recursive: true });
  const insight = (title, tags, recall) => `---\ntype: insight\ntitle: ${title}\ntags: [${tags}]\n---\n# ${title}\n\n## 何时想起\n\n${recall}\n\n## 内容\n\n详细方法与例题，只在需要时读取。\n`;
  await writeFile(join(vault, '锦囊', '几何', '反演.md'), insight('反演处理过定点的圆', '解析几何', '- 多个圆都过同一定点，要证共线或求轨迹时'));
  await writeFile(join(vault, '锦囊', '不动点.md'), insight('不动点找极限候选', '数列', '- 递推数列求极限、先找候选值时'));
  await writeFile(join(vault, '锦囊', '普通笔记.md'), '---\ntype: note\ntitle: 不是锦囊\n---\n正文\n');
  const row = { scope: 'set', body: '# 解析几何要点\n\n只写要点。\n' };
  const scoped = await skillContentWithInsights({ ...row, tags: ['解析几何'] }, vault);
  assert.match(scoped, /^# 解析几何要点/);
  assert.match(scoped, /## 锦囊索引/);
  assert.match(scoped, /反演处理过定点的圆（锦囊\/几何\/反演\.md）/);
  assert.match(scoped, /多个圆都过同一定点/);
  assert.doesNotMatch(scoped, /不动点/);
  assert.doesNotMatch(scoped, /详细方法与例题/, 'only the recall line is disclosed, never the body');
  const all = await skillContentWithInsights({ ...row, tags: [] }, vault);
  assert.match(all, /不动点找极限候选/);
  assert.doesNotMatch(all, /不是锦囊/);
  // No 锦囊 yet: the skill is served as written.
  assert.equal(await skillContentWithInsights(row, join(base, 'empty')), row.body);
});

const overview = ({ status = 'draft', subjects = '[数学, 物理]', coverage = '高中解析几何与力学', level = '高二', goal = '高考数学 130 分以上', deadline = '2027-06' } = {}) =>
  `---\ntype: skill\nid: learning-set\ntitle: 学习集梗概\ndescription: 本学习集学什么、面向什么水平、目标与期限。\nstatus: ${status}\nsubjects: ${subjects}\ncoverage: ${coverage}\nlevel: ${level}\ngoal: ${goal}\ndeadline: ${deadline}\n---\n# 学习集梗概\n\n高二学生，以课本与模拟卷为主。\n`;

test('the learning-set overview is a fixed skill whose four required fields must be present', async t => {
  const { OVERVIEW_ID } = await import('./user-skills.js');
  assert.equal(OVERVIEW_ID, 'learning-set');
  const parsed = parseUserSkill('learning-set.md', overview());
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.overview, { subjects: ['数学', '物理'], coverage: '高中解析几何与力学', level: '高二', goal: '高考数学 130 分以上', deadline: '2027-06', incomplete: [] });
  for (const [field, content] of [['subjects', overview({ subjects: '[]' })], ['coverage', overview().replace(/^coverage: .*\n/m, '')], ['level', overview({ level: '' })], ['goal', overview().replace(/^goal: .*\n/m, '')], ['deadline', overview().replace(/^deadline: .*\n/m, '')]]) {
    assert.equal(parseUserSkill('learning-set.md', content).error, 'overview_field_missing', field);
  }
  // Placeholders are allowed in a draft but mark what still needs filling.
  assert.deepEqual(parseUserSkill('learning-set.md', overview({ level: '待填写', deadline: '未知' })).overview.incomplete, ['level', 'deadline']);
});

test('an overview with placeholders cannot be turned on', async t => {
  const { set } = await roots(t);
  const saved = await saveUserSkill(set, { content: overview({ goal: '待填写' }) });
  await assert.rejects(setUserSkillStatus(set, { id: 'learning-set', status: 'active', expectedRevision: saved.revision }), /overview_incomplete/);
  const [row] = await readUserSkills(set, 'set');
  const fixed = await saveUserSkill(set, { content: overview(), expectedRevision: row.revision });
  assert.equal((await setUserSkillStatus(set, { id: 'learning-set', status: 'active', expectedRevision: fixed.revision })).status, 'active');
});

test('the lesson background reads the overview at every turn, whatever state it is in', async t => {
  const { learningSetOverview } = await import('./user-skills.js');
  const { base } = await roots(t);
  const vault = join(base, 'workspace');
  const missing = await learningSetOverview(vault, { subjectSkills: [] });
  assert.equal(missing.status, 'missing');
  assert.match(missing.hint, /技能页/);
  const setRoot = join(vault, '技能');
  const saved = await saveUserSkill(setRoot, { content: overview() });
  assert.equal((await learningSetOverview(vault, { subjectSkills: [] })).status, 'draft');
  await setUserSkillStatus(setRoot, { id: 'learning-set', status: 'active', expectedRevision: saved.revision });
  const active = await learningSetOverview(vault, { subjectSkills: [{ name: 'notara-subject-math', subjects: ['数学'] }, { name: 'notara-subject-physics', subjects: ['物理'] }, { name: 'notara-subject-chinese', subjects: ['语文'] }] });
  assert.equal(active.status, 'active');
  assert.deepEqual(active.subjects, ['数学', '物理']);
  assert.deepEqual(active.subjectSkills, ['notara-subject-math', 'notara-subject-physics']);
  assert.match(active.summary, /以课本与模拟卷为主/);
  assert.equal(active.skill, 'notara-set-learning-set');
});

test('a skill folder, skill file or recycle bin that is a link is refused instead of followed out of the Vault', async t => {
  const { set, base } = await roots(t);
  const { symlink } = await import('node:fs/promises');
  const outside = join(base, 'outside');
  await mkdir(outside, { recursive: true });
  await mkdir(join(base, 'vault'), { recursive: true });
  await symlink(outside, set, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(saveUserSkill(set, { content: skill() }), /skill_path_invalid/);
  assert.deepEqual(await readdir(outside), [], 'nothing was written through the linked folder');
  assert.equal((await readUserSkills(set, 'set')).every(row => row.error === 'skill_path_invalid'), true);
});

test('a linked skill file is refused instead of read outside the Vault', async t => {
  const { set, base } = await roots(t);
  const { symlink } = await import('node:fs/promises');
  const outside = join(base, 'outside');
  await mkdir(outside, { recursive: true });
  // A real folder whose skill file links elsewhere lists that file as invalid.
  await mkdir(set, { recursive: true });
  await writeFile(join(outside, 'secret.md'), skill({ id: 'linked' }));
  try { await symlink(join(outside, 'secret.md'), join(set, 'linked.md')); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows file symlink privilege is unavailable; directory junction escape is tested separately'); return; } throw error; }
  const [row] = await readUserSkills(set, 'set');
  assert.equal(row.error, 'skill_path_invalid');
});

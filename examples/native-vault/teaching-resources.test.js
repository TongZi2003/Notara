import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { teachingManifest, teachingLegacyAliases, teachingResource, teachingResourcePath } from './teaching-catalog.js';
import { apply } from './teacher.js';

const sourceRoot = new URL('../../resources/vault-teaching/', import.meta.url);
const bundleRoot = new URL('./teaching/', import.meta.url);

async function files(root, prefix = '') {
  const result = [];
  for (const item of await readdir(new URL(prefix, root), { withFileTypes: true })) {
    const name = `${prefix}${item.name}`;
    if (item.isDirectory()) result.push(...await files(root, `${name}/`));
    else result.push(name);
  }
  return result.sort();
}

test('the active teaching bundle is fresh, complete and has no retired leftover files', async () => {
  const sourceFiles = await files(sourceRoot);
  assert.deepEqual(await files(bundleRoot), sourceFiles, 'build the teaching bundle before testing');
  for (const name of sourceFiles) {
    assert.equal(await readFile(new URL(name, bundleRoot), 'utf8'), await readFile(new URL(name, sourceRoot), 'utf8'), name);
  }
  assert.deepEqual(teachingManifest, JSON.parse(await readFile(new URL('manifest.json', sourceRoot), 'utf8')));
});

test('the real teacher Skill provider lists distinct locators and retrieves each selected resource', async () => {
  let provider;
  apply({ effect: fn => fn(), skills: { registerProvider: create => { provider = create(); } } });
  const listed = await provider.list({});
  const rows = [...teachingManifest.choices, ...teachingManifest.skills];
  assert.equal(new Set(listed.map(row => row.name)).size, rows.length + Object.keys(teachingLegacyAliases).length);
  assert.equal(new Set(listed.filter(row => row.source === 'bundled').map(row => row.locator)).size, rows.length);
  for (const item of rows) {
    const entry = listed.find(row => row.name === `notara-${item.id}`);
    assert.ok(entry, item.id);
    assert.equal(entry.locator, item.file);
    const resource = await provider.get(entry);
    assert.equal(resource.content, teachingResource(item.file));
    assert.ok(resource.content.trim(), item.id);
    assert.equal(resource.name, entry.name);
  }
  for (const id of ['math', 'physics', 'chemistry', 'computing', 'chinese', 'english', 'science', 'humanities']) {
    assert.ok(listed.some(row => row.name === `notara-subject-${id}`), id);
  }
  for (const id of ['material-search', 'teaching-reflection', 'learning-review']) {
    const entry = listed.find(row => row.name === `notara-${id}`);
    assert.ok(entry, id);
    assert.deepEqual(entry.invocation, { modelInvocable: true, userInvocable: true });
  }
  assert.equal(teachingManifest.skills.find(row => row.id === 'teaching-reflection').menu, 'more');
  assert.notEqual(teachingManifest.skills.find(row => row.id === 'learning-review').menu, 'more');
  assert.deepEqual(teachingManifest.choices.map(row => row.id), ['mixed']);
  for (const [id, title] of [['consolidation', '头脑风暴与体系梳理']]) {
    const item = teachingManifest.skills.find(row => row.id === id);
    assert.ok(item, `${id} is registered`);
    assert.equal(item.title, title);
    assert.equal(item.menu, 'more', `${id} is grouped in the expanded skills menu`);
    assert.ok(listed.some(row => row.name === `notara-${id}`), `${id} is offered to the teacher`);
  }
  for (const [alias, target] of Object.entries(teachingLegacyAliases)) {
    const entry = listed.find(row => row.name === `notara-${alias}`);
    assert.ok(entry, alias);
    assert.equal(entry.invocation.modelInvocable, true);
    assert.equal(entry.invocation.userInvocable, false);
    const targetItem = [...teachingManifest.choices, ...teachingManifest.skills].find(row => row.id === target);
    assert.equal((await provider.get(entry)).content, teachingResource(targetItem.file), alias);
  }
  assert.deepEqual(await provider.list({ signal: AbortSignal.abort() }), []);
});

test('encoded path separators receive the teaching-resource domain error', () => {
  assert.throws(() => teachingResourcePath('%2e%2e%2f'), /teaching_resource_invalid/);
  assert.throws(() => teachingResource('%2e%2e%2f'), /teaching_resource_invalid/);
});

test('adopted user skills join the teacher catalog from both tiers; drafts never do', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { saveUserSkill, setUserSkillStatus } = await import('./user-skills.js');
  const base = await mkdtemp(join(tmpdir(), 'notara-teacher-skills-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'home'), workspace = join(base, 'workspace');
  await mkdir(join(workspace, '知识'), { recursive: true });
  const before = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => { if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before; });
  const file = (id, title, body) => `---\ntype: skill\nid: ${id}\ntitle: ${title}\ndescription: ${title}的要点。\nstatus: draft\n---\n${body}\n`;
  const global = join(home, 'notara-skills'), set = join(workspace, '技能');
  const g = await saveUserSkill(global, { content: file('analog-circuits', '模拟电子技术', '# 模电\n核心：工作点与小信号。') });
  const s = await saveUserSkill(set, { content: file('conic-inversion', '解析几何要点', '# 要点\n圆过定点时可考虑反演。') });
  await saveUserSkill(set, { content: file('still-draft', '草稿', '# 未启用') });
  let provider, invalidated = 0;
  const control = { signal: new AbortController().signal, invalidate: () => { invalidated += 1; } };
  apply({ effect: fn => fn(), skills: { registerProvider: create => { provider = create(control); } } });
  const names = async () => (await provider.list({ cwd: workspace })).map(row => row.name).filter(name => !name.startsWith('notara-') || /notara-(set|global)-/.test(name));
  assert.deepEqual((await names()).filter(name => /notara-(set|global)-/.test(name)), []);
  await setUserSkillStatus(global, { id: 'analog-circuits', status: 'active', expectedRevision: g.revision });
  await setUserSkillStatus(set, { id: 'conic-inversion', status: 'active', expectedRevision: s.revision });
  assert.equal(invalidated, 2, 'each adoption refreshes the cached catalog');
  const listed = await provider.list({ cwd: workspace });
  const setRow = listed.find(row => row.name === 'notara-set-conic-inversion');
  const globalRow = listed.find(row => row.name === 'notara-global-analog-circuits');
  assert.ok(setRow && globalRow);
  assert.ok(!listed.some(row => row.name === 'notara-set-still-draft'));
  assert.equal(setRow.description, '解析几何要点：解析几何要点的要点。');
  assert.match((await provider.get(setRow, { cwd: workspace })).content, /反演/);
  await mkdir(join(workspace, '锦囊'), { recursive: true });
  await writeFile(join(workspace, '锦囊', '反演.md'), '---\ntype: insight\ntitle: 反演处理过定点的圆\ntags: []\n---\n# 反演\n\n## 何时想起\n\n- 多个圆过同一定点时\n');
  const loaded = (await provider.get(setRow, { cwd: workspace })).content;
  assert.match(loaded, /## 锦囊索引/);
  assert.match(loaded, /反演处理过定点的圆（锦囊\/反演\.md）：多个圆过同一定点时/);
  assert.doesNotMatch((await provider.get(globalRow, { cwd: workspace })).content, /锦囊索引/, 'the shared tier carries no set-specific index');
  assert.doesNotMatch((await provider.get(setRow, { cwd: workspace })).content, /^---/);
  // Another learning set does not see this set's skills, only the shared tier.
  const elsewhere = (await provider.list({ cwd: join(base, 'other') })).map(row => row.name);
  assert.ok(elsewhere.includes('notara-global-analog-circuits'));
  assert.ok(!elsewhere.includes('notara-set-conic-inversion'));
});

test('every skill a teaching text or a brought-in reference names is a real skill', async () => {
  const known = new Set([...teachingManifest.skills, ...teachingManifest.choices].map(item => `notara-${item.id}`));
  const named = [];
  for (const name of (await files(sourceRoot)).filter(name => name.endsWith('.md'))) {
    const text = await readFile(new URL(name, sourceRoot), 'utf8');
    for (const [skill] of text.matchAll(/notara-[a-z][a-z0-9-]*[a-z0-9](?![a-z0-9-])/g)) named.push({ where: name, skill });
  }
  // What the student brings into the conversation tells the teacher which skill to load.
  const client = await readFile(new URL('./client-source.ts', import.meta.url), 'utf8');
  for (const [, skill] of client.matchAll(/(notara-[a-z0-9-]+) Skill/g)) named.push({ where: 'client-source.ts', skill });
  assert.ok(named.some(row => row.where === 'client-source.ts'), 'the PDF reference names its skill');
  assert.deepEqual(named.filter(row => !known.has(row.skill) && !/^notara-(set|global)$/.test(row.skill)), []);
});

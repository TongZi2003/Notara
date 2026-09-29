import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { insightRecall } from './learning-data.js';
import { resolveVaultRoot, revisionFor } from './vault.js';

/**
 * Skills the teacher writes and the student adopts, in two tiers:
 * - `set`: this learning set's overview and teaching hints, a visible Vault
 *   directory (`技能/`) that travels with the material;
 * - `global`: principles of a discipline shared by every Vault, under DSH_HOME.
 * One Markdown file per skill (`<id>.md`), frontmatter `type: skill`. A new
 * skill is always a draft; only the student turns it on. Changing an active
 * skill writes `<id>.revision.md`, which replaces the live text only when the
 * student adopts it. Every write compares the version the writer read.
 */
export const USER_SKILL_DIRECTORY = '技能';
export const USER_SKILL_SCOPES = Object.freeze({
  set: Object.freeze({ label: '学习集', prefix: 'notara-set-' }),
  global: Object.freeze({ label: '学科', prefix: 'notara-global-' }),
});
export const SKILL_LIMITS = Object.freeze({ title: 40, description: 300, content: 40000 });
/** The generated 锦囊 index discloses at most this much; the rest is found by search. */
export const INSIGHT_INDEX_LIMITS = Object.freeze({ entries: 40, recall: 160, chars: 6000 });
const INSIGHT_DIRECTORY = '锦囊';

/**
 * The learning-set overview: one fixed learning-set skill per Vault, read into
 * every turn's lesson background. Its four required facts are frontmatter
 * fields; a placeholder keeps a draft honest and blocks turning it on.
 */
export const OVERVIEW_ID = 'learning-set';
export const OVERVIEW_FIELDS = Object.freeze(['subjects', 'coverage', 'level', 'goal', 'deadline']);
const PLACEHOLDER = /^(待填写|未知|待定|TODO)$/i;
const OVERVIEW_SUMMARY = 800;
function overviewOf(head) {
  const subjects = Array.isArray(head.subjects) ? head.subjects.map(item => String(item).trim()).filter(Boolean) : [];
  const text = key => typeof head[key] === 'string' ? head[key].trim() : '';
  const fields = { subjects, coverage: text('coverage'), level: text('level'), goal: text('goal'), deadline: text('deadline') };
  if (!subjects.length || OVERVIEW_FIELDS.slice(1).some(key => !fields[key])) return null;
  const incomplete = OVERVIEW_FIELDS.filter(key => key === 'subjects' ? subjects.every(item => PLACEHOLDER.test(item)) : PLACEHOLDER.test(fields[key]));
  return { ...fields, incomplete };
}

const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const STATUSES = new Set(['draft', 'active']);
const REVISION_SUFFIX = '.revision.md';
const fail = code => { throw new Error(code); };

/** The shared tier lives under this runtime's DSH_HOME; without one there is none (never the user's own ~/.dsh). */
export const globalSkillRoot = (env = process.env) => env.DSH_HOME ? join(env.DSH_HOME, 'notara-skills') : null;
/** The learning-set tier of the Vault a classroom works in. */
export const setSkillRoot = workspacePath => join(resolveVaultRoot(workspacePath), USER_SKILL_DIRECTORY);
/** Fired after the student turns a skill on or off or adopts a revision. */
export const userSkillChanges = new EventTarget();
export const announceUserSkills = () => userSkillChanges.dispatchEvent(new Event('change'));
export const userSkillName = (scope, id) => USER_SKILL_SCOPES[scope].prefix + id;

/** Parse one file; an invalid file carries its first failing reason. */
export function parseUserSkill(fileName, content) {
  const pending = fileName.endsWith(REVISION_SUFFIX);
  const fileId = fileName.slice(0, -(pending ? REVISION_SUFFIX.length : '.md'.length));
  let parsed;
  try { parsed = parseFrontmatter(content); } catch { return { error: 'skill_type_invalid' }; }
  const head = parsed.frontmatter;
  if (head.type !== 'skill') return { error: 'skill_type_invalid' };
  if (typeof head.id !== 'string' || !SKILL_ID.test(head.id)) return { error: 'skill_id_invalid' };
  const id = head.id;
  if (id !== fileId) return { id, error: 'skill_id_mismatch' };
  if (typeof head.title !== 'string' || !head.title.trim() || head.title.length > SKILL_LIMITS.title) return { id, error: 'skill_title_invalid' };
  if (typeof head.description !== 'string' || !head.description.trim() || head.description.length > SKILL_LIMITS.description) return { id, error: 'skill_description_invalid' };
  if (!STATUSES.has(head.status)) return { id, error: 'skill_status_invalid' };
  if (pending && (head.revises !== id || head.status !== 'draft')) return { id, error: 'skill_revision_invalid' };
  if (!parsed.body.trim()) return { id, error: 'skill_body_empty' };
  const overview = id === OVERVIEW_ID ? overviewOf(head) : undefined;
  if (overview === null) return { id, error: 'overview_field_missing' };
  return { id, title: head.title.trim(), description: head.description.trim(), status: head.status, body: parsed.body, frontmatter: head, revision: revisionFor(content), ...(overview ? { overview } : {}) };
}

/** A skill folder, file or recycle bin that is a symbolic link (or a Windows
 * junction) could lead out of the Vault; this Host-side code runs outside the
 * shell sandbox, so it refuses them instead of following. */
async function refuseLink(path) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  if (info.isSymbolicLink()) fail('skill_path_invalid');
}
async function readText(path) {
  await refuseLink(dirname(path)); await refuseLink(path);
  try { return await readFile(path, 'utf8'); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
async function writeAtomic(root, name, content) {
  await refuseLink(root); await refuseLink(join(root, name));
  await mkdir(root, { recursive: true });
  const target = join(root, name), temporary = `${target}.notara-${randomUUID()}`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
}
/** Keep a replaced or discarded text recoverable instead of deleting it. */
async function keep(root, name) {
  const trash = join(root, '.trash');
  await refuseLink(trash); await refuseLink(join(root, name));
  await mkdir(trash, { recursive: true });
  await rename(join(root, name), join(trash, `${name.replace(/\.md$/, '')}-${Date.now()}.md`));
}
const withHead = (head, body) => serializeFrontmatter(head) + body;

/**
 * Every skill in one root, with the pending revision attached to its skill.
 * @returns rows sorted by id; invalid files keep their reason in `error`.
 */
export async function readUserSkills(root, scope) {
  let names;
  try { await refuseLink(root); } catch { return [{ scope, file: '', error: 'skill_path_invalid' }]; }
  try { names = await readdir(root); } catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const text = async file => { try { return await readText(join(root, file)) ?? ''; } catch (error) { if (error instanceof Error && error.message === 'skill_path_invalid') return null; throw error; } };
  const files = names.filter(name => name.endsWith('.md') && !name.startsWith('.')).sort();
  const pending = new Map(), rows = [];
  for (const file of files.filter(name => name.endsWith(REVISION_SUFFIX))) {
    const content = await text(file);
    if (content === null) continue;
    const parsed = parseUserSkill(file, content);
    if (!parsed.error) pending.set(parsed.id, { revision: parsed.revision, title: parsed.title, description: parsed.description, body: parsed.body, file });
  }
  for (const file of files.filter(name => !name.endsWith(REVISION_SUFFIX))) {
    const content = await text(file);
    if (content === null) { rows.push({ scope, file, error: 'skill_path_invalid' }); continue; }
    const parsed = parseUserSkill(file, content);
    if (parsed.error) { rows.push({ scope, file, ...(parsed.id ? { id: parsed.id } : {}), error: parsed.error }); continue; }
    const tags = Array.isArray(parsed.frontmatter.tags) ? parsed.frontmatter.tags.filter(tag => typeof tag === 'string' && tag.trim()) : [];
    rows.push({ scope, file, id: parsed.id, name: userSkillName(scope, parsed.id), title: parsed.title, description: parsed.description,
      status: parsed.status, revision: parsed.revision, body: parsed.body, tags, ...(parsed.overview ? { overview: parsed.overview } : {}), ...(pending.has(parsed.id) ? { pending: pending.get(parsed.id) } : {}) });
  }
  return rows;
}

/**
 * The teacher's only write path. A new skill is created as a draft, a draft is
 * edited against its version, and an active skill only gains a pending
 * revision the student decides on.
 */
export async function saveUserSkill(root, { content, expectedRevision }) {
  if (typeof content !== 'string' || content.length > SKILL_LIMITS.content) fail('skill_content_invalid');
  let head;
  try { head = parseFrontmatter(content).frontmatter; } catch { fail('skill_type_invalid'); }
  const id = typeof head.id === 'string' && SKILL_ID.test(head.id) ? head.id : fail('skill_id_invalid');
  const mainName = `${id}.md`, pendingName = `${id}${REVISION_SUFFIX}`;
  const current = await readText(join(root, mainName));
  const live = current === null ? null : parseUserSkill(mainName, current);
  if (live && !live.error && live.status === 'active') {
    const proposal = parseUserSkill(pendingName, withHead({ ...head, status: 'draft', revises: id }, parseFrontmatter(content).body));
    if (proposal.error) fail(proposal.error);
    const existing = await readText(join(root, pendingName));
    const base = existing === null ? live.revision : revisionFor(existing);
    if (expectedRevision !== base) fail(expectedRevision === undefined ? 'skill_revision_required' : 'skill_revision_conflict');
    // A newer proposal replaces the one the student has not adopted; that text stays recoverable.
    if (existing !== null) await keep(root, pendingName);
    await writeAtomic(root, pendingName, withHead({ ...proposal.frontmatter }, proposal.body));
    return { id, status: 'active', op: 'revision', revision: proposal.revision };
  }
  const parsed = parseUserSkill(mainName, content);
  if (parsed.error) fail(parsed.error);
  if (parsed.status !== 'draft') fail('skill_status_reserved');
  if (current !== null) {
    if (expectedRevision === undefined) fail('skill_revision_required');
    if (expectedRevision !== revisionFor(current)) fail('skill_revision_conflict');
  }
  await writeAtomic(root, mainName, content);
  return { id, status: 'draft', op: current === null ? 'create' : 'edit', revision: parsed.revision };
}

async function liveSkill(root, id, expectedRevision) {
  if (typeof id !== 'string' || !SKILL_ID.test(id)) fail('skill_id_invalid');
  const content = await readText(join(root, `${id}.md`));
  if (content === null) fail('skill_not_found');
  const parsed = parseUserSkill(`${id}.md`, content);
  if (parsed.error) fail(parsed.error);
  if (expectedRevision !== parsed.revision) fail('skill_revision_conflict');
  return parsed;
}

/** The adopted skills a classroom working in `cwd` may use: its set tier and the shared tier. */
export async function activeUserSkills({ cwd, env = process.env } = {}) {
  const rows = [], global = globalSkillRoot(env);
  if (global) rows.push(...await readUserSkills(global, 'global'));
  if (cwd) rows.push(...await readUserSkills(setSkillRoot(cwd), 'set'));
  return rows.filter(row => !row.error && row.status === 'active');
}

/** The student's switch: draft ↔ active, against the version they saw. */
export async function setUserSkillStatus(root, { id, status, expectedRevision }) {
  if (!STATUSES.has(status)) fail('skill_status_invalid');
  const parsed = await liveSkill(root, id, expectedRevision);
  if (status === 'active' && parsed.overview?.incomplete.length) fail('overview_incomplete');
  const content = withHead({ ...parsed.frontmatter, status }, parsed.body);
  await writeAtomic(root, `${id}.md`, content);
  announceUserSkills();
  return { id, status, revision: revisionFor(content) };
}

/** The student adopts or discards a pending revision of an active skill. */
export async function resolveSkillRevision(root, { id, action, expectedRevision }) {
  if (action !== 'accept' && action !== 'discard') fail('skill_action_invalid');
  if (typeof id !== 'string' || !SKILL_ID.test(id)) fail('skill_id_invalid');
  const pendingName = `${id}${REVISION_SUFFIX}`, text = await readText(join(root, pendingName));
  if (text === null) fail('skill_revision_not_found');
  const proposal = parseUserSkill(pendingName, text);
  if (proposal.error) fail(proposal.error);
  if (expectedRevision !== proposal.revision) fail('skill_revision_conflict');
  if (action === 'discard') { await keep(root, pendingName); announceUserSkills(); return { id, action }; }
  const current = await readText(join(root, `${id}.md`));
  const live = current === null ? null : parseUserSkill(`${id}.md`, current);
  if (live && !live.error && live.status === 'active' && proposal.overview?.incomplete.length) fail('overview_incomplete');
  const { revises: _revises, ...head } = proposal.frontmatter;
  const content = withHead({ ...head, status: live && !live.error ? live.status : 'draft' }, proposal.body);
  if (current !== null) await keep(root, `${id}.md`);
  await writeAtomic(root, `${id}.md`, content);
  await keep(root, pendingName);
  announceUserSkills();
  return { id, action, status: parseUserSkill(`${id}.md`, content).status, revision: revisionFor(content) };
}

/**
 * Copy a learning-set skill into another set as that set's own draft, noting
 * where it came from. The two then grow apart; nothing links them afterwards.
 */
export async function inheritUserSkill(fromRoot, toRoot, { id, from }) {
  if (typeof id !== 'string' || !SKILL_ID.test(id)) fail('skill_id_invalid');
  const source = await readText(join(fromRoot, `${id}.md`));
  if (source === null) fail('skill_not_found');
  const parsed = parseUserSkill(`${id}.md`, source);
  if (parsed.error) fail(parsed.error);
  if (await readText(join(toRoot, `${id}.md`)) !== null) fail('skill_exists');
  const origin = String(from ?? '').replace(/[\r\n]/g, ' ').trim().slice(0, 80);
  const content = withHead({ ...parsed.frontmatter, status: 'draft', ...(origin ? { inherits: `${origin}/${id}` } : {}) }, parsed.body);
  await writeAtomic(toRoot, `${id}.md`, content);
  return { id, status: 'draft', revision: revisionFor(content) };
}

async function insightFiles(root, prefix = '') {
  let entries;
  try { entries = await readdir(join(root, prefix), { withFileTypes: true }); } catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await insightFiles(root, path));
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(path);
  }
  return found;
}

/**
 * The third tier: a learning-set skill is served with an index of the 锦囊 it
 * covers, generated from the 锦囊 files each time it is loaded, so the index
 * never drifts and a new 锦囊 needs no skill revision. Only the title, its
 * place and its own `## 何时想起` passage are disclosed; the teacher reads a
 * 锦囊 in full only when its condition fits. A skill with `tags` lists the 锦囊
 * sharing one of them; a skill without tags lists them all.
 */
export async function skillContentWithInsights(row, vaultRoot) {
  const wanted = new Set(row.tags ?? []), lines = [];
  let omitted = 0, size = 0;
  for (const path of await insightFiles(join(vaultRoot, INSIGHT_DIRECTORY))) {
    const text = await readText(join(vaultRoot, INSIGHT_DIRECTORY, path));
    if (text === null) continue;
    let head;
    try { head = parseFrontmatter(text).frontmatter; } catch { continue; }
    if (head.type !== 'insight') continue;
    const tags = Array.isArray(head.tags) ? head.tags : [];
    if (wanted.size && !tags.some(tag => wanted.has(tag))) continue;
    const title = typeof head.title === 'string' && head.title.trim() ? head.title.trim() : path.replace(/\.md$/, '');
    const recall = (insightRecall(text) ?? '').replace(/^\s*-\s*(\[[ xX]\]\s*)?/gm, '').replace(/\s+/g, ' ').trim();
    const line = `- ${title}（${INSIGHT_DIRECTORY}/${path}）${recall ? `：${Array.from(recall).slice(0, INSIGHT_INDEX_LIMITS.recall).join('')}` : ''}`;
    if (lines.length >= INSIGHT_INDEX_LIMITS.entries || size + line.length > INSIGHT_INDEX_LIMITS.chars) { omitted += 1; continue; }
    lines.push(line); size += line.length;
  }
  if (!lines.length) return row.body;
  return `${row.body.replace(/\s*$/, '')}\n\n## 锦囊索引\n\n本学习集已沉淀的锦囊（自动生成，只列标题与何时想起）。条件符合当前题目或学生表现时，用 shell 读对应锦囊全文，不一次读完。\n\n${lines.join('\n')}\n${omitted ? `\n另有 ${omitted} 份锦囊未列出，按 notara-material-search 检索。\n` : ''}`;
}

/**
 * What every turn's lesson background says about this learning set: the
 * adopted overview (facts, a bounded summary and the subject skills its
 * subjects map to), or that a draft awaits the student, or that none exists
 * and the teacher may suggest creating one.
 * @param subjectSkills - `{name, subjects}` rows: built-in subject skills and adopted shared ones.
 */
export async function learningSetOverview(vaultRoot, { subjectSkills = [] } = {}) {
  const rows = await readUserSkills(join(vaultRoot, USER_SKILL_DIRECTORY), 'set');
  const row = rows.find(item => item.id === OVERVIEW_ID);
  if (!row) return { status: 'missing', hint: `本学习集还没有梗概（科目、学什么、学段或水平、目标与期限）。可以直接按 notara-skill-authoring 起草一份草稿：依据本 Vault 已有的资料与本次对话，推不出的必填项先问学生，问不到写“待填写”；保存后告诉学生去技能页确认。学生也可以自己在技能页创建。学生不想现在处理就照常上课，不反复提。` };
  if (row.error) return { status: 'invalid', hint: `学习集梗概文件格式有误（${row.error}），请学生在 Vault 里修正或请老师重写。` };
  if (row.status !== 'active') return { status: 'draft', incomplete: row.overview?.incomplete ?? [], hint: '学习集梗概还是草稿，等学生在技能页确认；确认前以学生本次所说为准。' };
  const { subjects, coverage, level, goal, deadline } = row.overview;
  const matched = subjectSkills.filter(skill => skill.subjects.some(name => subjects.some(subject => subject.includes(name) || name.includes(subject)))).map(skill => skill.name);
  const summary = Array.from(row.body.trim()).slice(0, OVERVIEW_SUMMARY).join('');
  return { status: 'active', subjects, coverage, level, goal, deadline, subjectSkills: [...new Set(matched)], summary, skill: row.name };
}

/** The draft a student creates from settings; every required fact starts as a placeholder. */
export const OVERVIEW_TEMPLATE = `---
type: skill
id: ${OVERVIEW_ID}
title: 学习集梗概
description: 这个学习集学什么、面向什么水平、目标与期限；每次对话开始时读取。
status: draft
subjects: [待填写]
coverage: 待填写
level: 待填写
goal: 待填写
deadline: 待填写
tags: []
---
# 学习集梗概

## 学什么

## 学生情况

## 目标与期限

## 主要资料

## 教学方法提示
`;

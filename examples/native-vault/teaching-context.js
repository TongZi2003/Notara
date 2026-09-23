// L0 动态教学上下文：渐进披露的装配层。
//
// 这里只做三件确定的事：
//   1. 用显式注入的 reader/scopes 读出「有界本课剧本概览」和「显式绑定的前课小结」；
//   2. 给出画像/锦囊的少量入口与候选触发说明，不用关键词替教师选教学法；
//   3. 把结果裁进一个明确的 Unicode 字符预算，超预算时整条丢弃并如实记录。
//
// 没有缓存、没有模块级状态：同样的输入每次都重建同样的结果，每次调用都重新
// 读取并重新核对 revision。没有读取过的正文不会被说成已经读过；跨集只发生在
// 调用方显式给出的 reader 上，`scope` 缺失时如实返回不可用而不是退回当前集。
//
// 主 Agent 直接使用本函数；子 Agent 的个人背景仍由调用方（原生 runtime）过滤，
// 这里返回的正文永远是有界摘要，不含整份画像或小结。

import { lessonOutline } from './lesson-script.js';
import { parseLessonSummaries } from './lesson-data.js';

/** 教学记忆动态 context 的默认总预算，见 docs/migration/2026-09-21-teaching-memory-loading.md 第 4 节。 */
export const CONTEXT_BUDGET = 1200;

/** L0 只披露入口，不替教师决定查什么。 */
export const CONTEXT_ENTRIES = Object.freeze({
  memory: 'glob / grep 查画像、锦囊与卡片的学生理解 → read 历史及后续修正；规范见 notara-material-search Skill',
  lessonLog: '辅助脚本 lesson-log 查询 → read 对应小结',
  material: 'glob / grep → read；PDF 按页读取见 notara-vault-workflow Skill',
});

export const CONTEXT_TRIGGER = [
  '新题讲解、选路或诊断前，按当前结构、目标与实际作答查相关画像、锦囊和学生理解；',
  '出现新障碍、学生提出另一条路线或提起旧经历时可以再查；',
  '候选只由字面/标签/图关系产生，是否相关与是否换教法由教师语义判断，命中不自动切换教法。',
  '旧错误须结合后来修正及反证，不直接代表当前认识。',
].join('');

const SCRIPT_TYPE = 'lesson';
const FAILURE_LIMIT = 4;
const FAILURE_CODE_LIMIT = 48;
const FAILURE_CODE_PATTERN = /^[a-z][a-z0-9_]*$/i;
const FOOTER = '（已达预算上限，未列出的条目没有读入；需要时按上面的入口继续读）';

const DEFAULT_LIMITS = Object.freeze({
  scriptSections: 3,
  sectionTitle: 40,
  goal: 200,
  instructions: 200,
  continuation: 400,
  hintRecall: 120,
  hintTitle: 60,
  conventions: 3,
  hints: 3,
});

function fail(code) { throw new Error(code); }
function asText(value) { return typeof value === 'string' ? value : ''; }

/** 预算以 Unicode 字符（code point）计，和文档口径一致，不用 UTF-16 长度。 */
function points(value) { return Array.from(asText(value)).length; }

function clip(value, limit) {
  const text = asText(value);
  const list = Array.from(text);
  if (list.length <= limit) return { text, truncated: false };
  return { text: list.slice(0, limit).join(''), truncated: true };
}

function singleLine(value) { return asText(value).replace(/\s+/gu, ' ').trim(); }

/** 读取失败只保留有界错误码。仓库里的失败都是 `fail(code)` 抛出的机器码；
 * 带空格、换行、堆栈或路径的报文一律不收，避免把内部细节带进动态上下文。 */
function failureCode(error) {
  for (const raw of [error?.code, error?.message]) {
    const value = singleLine(raw);
    if (!value || value.length > 64 || !FAILURE_CODE_PATTERN.test(value)) continue;
    return value.toLowerCase().slice(0, FAILURE_CODE_LIMIT);
  }
  return 'read_failed';
}

function normalizeBudget(value) {
  const budget = value === undefined || value === null ? CONTEXT_BUDGET : value;
  if (!Number.isInteger(budget) || budget < 1) fail('teaching_context_budget_invalid');
  return budget;
}

/** 注入的 reader 与 scope 成对出现；顺序即显式范围，索引 0 是当前学习集。 */
function normalizeReaders(readers) {
  if (readers === undefined || readers === null) return [];
  if (!Array.isArray(readers)) fail('teaching_context_readers_invalid');
  return readers.map(reader => {
    if (!reader || typeof reader !== 'object' || typeof reader.read !== 'function') fail('teaching_context_reader_invalid');
    const id = asText(reader.scope?.id).trim() || fail('teaching_context_scope_invalid');
    const title = singleLine(reader.scope?.title) || id;
    return { scope: { id, title }, read: reader.read.bind(reader) };
  });
}

function locate(readers, scopeId) {
  const wanted = asText(scopeId).trim();
  if (!wanted) return readers[0] ?? null;
  return readers.find(reader => reader.scope.id === wanted) ?? null;
}

function normalizePointer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const path = asText(value.path).trim();
  if (!path) return null;
  return {
    scopeId: asText(value.scopeId).trim() || null,
    path,
    anchor: asText(value.anchor).trim() || null,
    revision: asText(value.revision).trim() || null,
    title: singleLine(value.title) || null,
  };
}

/** 有界剧本概览：只给类型、小节目录和真实 revision，正文不进入 L0。 */
async function scriptOverview(reader, settings, limits, failures) {
  const path = asText(settings.scriptPath).trim();
  if (!path) return null;
  const boundRevision = asText(settings.scriptRevision).trim() || null;
  let document;
  try { document = await reader.read(path); }
  catch (error) { failures.push({ code: failureCode(error), target: `剧本 ${path}` }); return { path, error: failureCode(error) }; }

  const revision = asText(document?.revision).trim() || null;
  const stale = Boolean(boundRevision && revision && boundRevision !== revision);
  const type = asText(document?.type).trim() || asText(document?.frontmatter?.type).trim() || null;
  if (stale) failures.push({ code: 'script_stale', target: `剧本 ${path}` });
  else if (type && type !== SCRIPT_TYPE) failures.push({ code: 'script_type_mismatch', target: `剧本 ${path}` });

  let outline;
  try { outline=lessonOutline(document,{limit:Math.max(1,Math.min(100,limits.scriptSections))}); }
  catch(error) { failures.push({code:failureCode(error),target:`剧本 ${path}`});return {path,error:failureCode(error)}; }
  const kept = outline.sections.map(section => clip(singleLine(section.title), limits.sectionTitle));
  return {
    path,
    title: singleLine(document?.title) || null,
    type,
    revision,
    ...(boundRevision ? { boundRevision } : {}),
    stale,
    sectionCount: outline.total,
    sections: kept.map(item => item.text),
    navigation: outline.sections.map((section,index)=>({...section,title:kept[index].text})),
    sectionsTruncated: kept.some(item => item.truncated) || outline.nextOffset!==null,
    warnings: outline.warnings,
    readWith: 'lesson-outline → lesson-section (section + expectedRevision)',
    bodyRead: false,
  };
}

/** 前课只读绑定指向的那一条；没有显式绑定时不按关键词去日志里挑一条。 */
async function previousLessonBrief(readers, pointer, limits, failures) {
  if (!pointer) return null;
  const reader = locate(readers, pointer.scopeId);
  const label = `前课 ${pointer.path}`;
  if (!reader) { failures.push({ code: 'scope_unavailable', target: label }); return { path: pointer.path, scopeId: pointer.scopeId, error: 'scope_unavailable' }; }

  let document;
  try { document = await reader.read(pointer.path); }
  catch (error) { failures.push({ code: failureCode(error), target: label }); return { path: pointer.path, error: failureCode(error) }; }

  let summary = null;
  try {
    const rows = parseLessonSummaries(document);
    summary = pointer.anchor ? rows.find(row => row.anchor === pointer.anchor) ?? null : rows.at(-1) ?? null;
  } catch (error) { failures.push({ code: failureCode(error), target: label }); return { path: pointer.path, error: failureCode(error) }; }
  if (!summary) { failures.push({ code: 'previous_lesson_not_found', target: label }); return { path: pointer.path, anchor: pointer.anchor, error: 'previous_lesson_not_found' }; }

  const revision = asText(document?.revision).trim() || null;
  const stale = Boolean(pointer.revision && revision && pointer.revision !== revision);
  if (stale) failures.push({ code: 'previous_lesson_stale', target: label });
  const continuation = clip(singleLine(summary.continuation ?? ''), limits.continuation);
  return {
    scopeId: reader.scope.id,
    path: pointer.path,
    anchor: summary.anchor,
    ref: asText(document?.ref) || null,
    title: singleLine(summary.title) || pointer.title || null,
    revision,
    ...(pointer.revision ? { boundRevision: pointer.revision } : {}),
    stale,
    continuation: continuation.text || null,
    continuationTruncated: continuation.truncated,
  };
}

/** 画像线索只来自调用方显式给出的条目（学生自己设定的通用约定或本课明确关联的记录）。 */
function profileBrief(profile, limits) {
  const conventions = (Array.isArray(profile?.conventions) ? profile.conventions : []).slice(0, limits.conventions)
    .map(item => ({ title: clip(singleLine(item?.title), limits.hintTitle).text, ref: asText(item?.ref).trim() }))
    .filter(item => item.title)
    .map(item => ({ title: item.title, ...(item.ref ? { ref: item.ref } : {}) }));
  const hints = (Array.isArray(profile?.hints) ? profile.hints : []).slice(0, limits.hints)
    .map(item => ({ title: clip(singleLine(item?.title), limits.hintTitle).text, recall: clip(singleLine(item?.recall), limits.hintRecall).text, ref: asText(item?.ref).trim() }))
    .filter(item => item.title)
    .map(item => ({ title: item.title, recall: item.recall || null, ...(item.ref ? { ref: item.ref } : {}) }));
  return { conventions, hints, provided: conventions.length > 0 || hints.length > 0 };
}

/** 按优先级整条装入（同优先级保持声明顺序）；装不下的条目整条丢弃，
 * 绝不切开一条正文，也不产生半截 JSON。 */
function fit(sections, budget) {
  const ordered = [...sections].sort((left, right) => left.priority - right.priority);
  const kept = [], dropped = [];
  let used = 0, truncated = false;
  for (const section of ordered) {
    const lines = [];
    for (const line of section.lines) {
      const cost = (used + lines.length > 0 ? 1 : 0) + points(line);
      if (used + cost > budget) { truncated = true; break; }
      lines.push(line); used += cost;
    }
    if (!lines.length) { if (section.lines.length) dropped.push(section.key); }
    else kept.push(...lines);
  }
  return { lines: kept, dropped, truncated, used };
}

function scopeLine(scope, readers) {
  const others = readers.filter(reader => reader.scope.id !== scope?.id).map(reader => reader.scope.title);
  const cross = others.length ? `已接入范围：${others.join('、')}；实际读取仍经过原生权限` : '本段只读当前集；需要跨集时按已知且获授权的目录用原生文件工具检索，未读取的范围保持未知';
  return `- 学习集：${scope ? scope.title : '未确定'}｜${cross}`;
}

function scriptLines(script) {
  if (!script) return ['- 剧本：本课未绑定剧本，按当前材料推进。'];
  if (script.error) return [`- 剧本：${script.path} 读取失败（${script.error}），未被读入。`];
  const stamp = script.stale ? '绑定后已变动' : '当前版本';
  const head = `- 剧本概览：${script.title ?? script.path}（${script.path}，${script.sectionCount} 节，正文未读）`;
  const tail = script.sections.length ? `｜小节：${script.sections.join(' / ')}${script.sectionsTruncated ? ' …' : ''}` : '';
  return [`${head}｜${stamp}${tail}｜按阶段用 lesson-section 读取；${script.stale ? '先核对改动并重新绑定' : '使用目录的 section 与 revision'}`];
}

function previousLines(previous) {
  if (!previous) return ['- 前课：本课未绑定前课小结，不推测上一节内容。'];
  if (previous.error) return [`- 前课：${previous.path} 不可用（${previous.error}），未被读入。`];
  const head = `- 前课小结（仅显式绑定）：${previous.title ?? previous.path}（${previous.path}）`;
  const body = previous.continuation ? `｜下次从这里继续：${previous.continuation}${previous.continuationTruncated ? '…' : ''}` : '｜本条未写「下次从这里继续」';
  return [`${head}${body}${previous.stale ? '｜绑定后已变动，以当前版本为准' : ''}`];
}

function profileLines(profile) {
  const lines = [`- 画像入口：${CONTEXT_ENTRIES.memory}（只按当前题目结构查候选，不预先挑条目）`];
  if (profile.conventions.length) lines.push(`- 通用教学约定：${profile.conventions.map(item => item.title).join('、')}`);
  for (const hint of profile.hints) lines.push(`- 本课相关线索：${hint.title}${hint.recall ? `：${hint.recall}` : ''}`);
  if (!profile.provided) lines.push('- 画像：本课没有显式指定的条目，需要时由教师按当前疑问检索。');
  return lines;
}

function failureLines(failures) {
  if (!failures.length) return [];
  const rows = failures.slice(0, FAILURE_LIMIT).map(item => `${item.code}（${item.target}）`);
  const more = failures.length > FAILURE_LIMIT ? `，另有 ${failures.length - FAILURE_LIMIT} 条` : '';
  return [`- 读取失败：${rows.join('；')}${more}`];
}

/**
 * 装配本课的动态教学上下文。
 *
 * 调用形状（父层 runtime 侧）：
 *   const context = await assembleTeachingContext({
 *     readers: [{ scope: { id, title }, read: (path) => document }],
 *     settings, previousLesson, profile, budget,
 *   });
 *
 * - `readers`：显式注入的 scope + reader 对，索引 0 是当前学习集；
 *   其他集必须由调用方显式加入，本函数不会自行扩展范围。
 * - `read(path)` 的返回值沿用 Vault 读侧形状：`{path,title,type,frontmatter,content,revision,ref}`。
 * - `settings`：本课设置（`scriptPath`、可选的 `scriptRevision` 绑定快照、`learningGoal`、
 *   `temporaryInstructions`、`subjects`）。
 * - `previousLesson`：只指向前课小结的显式绑定 `{scopeId?,path,anchor?,revision?,title?}`。
 * - `profile`：学生显式设定的通用约定与本课明确关联的条目线索，不由检索结果自动产生。
 *
 * 返回 `{text,budget,length,truncated,dropped,context,scope,entries,failures,script,previous}`：
 * `text` 已装进预算；`context` 是同一份事实的结构化投影，字段本身都有界，因此
 * 永远可以完整序列化，不会被切成半截 JSON。读取失败、范围不可用和绑定后变动
 * 都进 `failures`，并在正文里如实出现。
 */
export async function assembleTeachingContext({
  readers,
  settings = {},
  previousLesson = null,
  profile = {},
  budget,
  limits,
} = {}) {
  const total = normalizeBudget(budget);
  const bounds = { ...DEFAULT_LIMITS, ...(limits ?? {}) };
  const sources = normalizeReaders(readers);
  if (!sources.length) fail('teaching_context_reader_required');
  const current = sources[0];
  const failures = [];

  const goal = clip(singleLine(settings.learningGoal?.title ?? settings.learningGoal), bounds.goal);
  const instructions = clip(singleLine(settings.temporaryInstructions), bounds.instructions);
  const subjects = (Array.isArray(settings.subjects) ? settings.subjects : [])
    .map(item => clip(singleLine(item), 40).text).filter(Boolean).slice(0, 8);

  const [script, previous] = await Promise.all([
    settings.scriptPath && settings.scriptWorkspaceId && !locate(sources,settings.scriptWorkspaceId)
      ? Promise.resolve({path:settings.scriptPath,error:'scope_unavailable'})
      : scriptOverview(locate(sources,settings.scriptWorkspaceId)??current, settings, bounds, failures),
    settings.continuation ? Promise.resolve({title:settings.continuation.title,path:settings.continuation.path??'已绑定前课',continuation:settings.continuation.text,ref:settings.continuation.ref,snapshot:true}) : previousLessonBrief(sources, normalizePointer(previousLesson), bounds, failures),
  ]);
  const portrait = profileBrief(profile, bounds);

  const settingLines = [];
  if (goal.text) settingLines.push(`- 本课目标：${goal.text}${goal.truncated ? '…' : ''}`);
  if (instructions.text) settingLines.push(`- 临时要求：${instructions.text}${instructions.truncated ? '…' : ''}`);
  if (subjects.length) settingLines.push(`- 科目：${subjects.join('、')}`);

  const sections = [
    { key: 'scope', priority: 0, lines: ['本课动态背景（有界装配，未读取的正文不在此列）', scopeLine(current.scope, sources)] },
    { key: 'entries', priority: 0, lines: [`- 候选触发：${CONTEXT_TRIGGER}`] },
    { key: 'profile', priority: 1, lines: profileLines(portrait) },
    { key: 'failures', priority: 2, lines: failureLines(failures) },
    { key: 'settings', priority: 3, lines: settingLines },
    { key: 'script', priority: 4, lines: scriptLines(script) },
    { key: 'previous', priority: 5, lines: previousLines(previous) },
    { key: 'prelude', priority: 6, lines: [`- 资料入口：${CONTEXT_ENTRIES.material}；课堂日志：${CONTEXT_ENTRIES.lessonLog}`] },
  ];

  let fitted = fit(sections, total);
  if (fitted.truncated) {
    const footerCost = points(FOOTER);
    if (total - footerCost - 1 > 0) {
      const trimmed = fit(sections, total - footerCost - 1);
      fitted = { ...trimmed, lines: [...trimmed.lines, FOOTER], truncated: true, used: trimmed.used + footerCost + 1 };
    }
  }
  const text = fitted.lines.join('\n');

  const context = {
    学习集: { id: current.scope.id, title: current.scope.title },
    范围: { 当前集: current.scope.title, 显式跨集: sources.slice(1).map(reader => reader.scope.title), 未列出的集: '本段未读取' },
    本课目标: goal.text || null,
    临时要求: instructions.text || null,
    科目: subjects,
    剧本: script,
    前课: previous,
    画像: { 入口: CONTEXT_ENTRIES.memory, 通用约定: portrait.conventions, 线索: portrait.hints, 已显式指定: portrait.provided },
    候选触发: CONTEXT_TRIGGER,
    读取失败: failures.slice(0, FAILURE_LIMIT),
    预算: { total, used: points(text), truncated: fitted.truncated, dropped: fitted.dropped },
  };

  return {
    text,
    budget: total,
    length: points(text),
    truncated: fitted.truncated,
    dropped: [...fitted.dropped],
    context,
    scope: { ...current.scope },
    entries: { ...CONTEXT_ENTRIES },
    failures: context.读取失败,
    script,
    previous,
  };
}

export default assembleTeachingContext;

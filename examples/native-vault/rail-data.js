import { civilDay } from './calendar-data.js';

/** The rail from top to bottom; 设置 is the native slot below. */
export const RAIL_SECTIONS = Object.freeze([
  Object.freeze({ id: 'home', label: '首页', icon: 'home' }),
  Object.freeze({ id: 'plan', label: '计划', icon: 'clock' }),
  Object.freeze({ id: 'vault', label: 'Vault', icon: 'books' }),
  Object.freeze({ id: 'skills', label: '技能', icon: 'sparkle' }),
]);
export const PLAN_VIEWS = Object.freeze([['calendar', '日历'], ['routes', '路线'], ['review', '复习'], ['scheduled', '定时任务']]);
export const VAULT_VIEWS = Object.freeze([['files', '文件'], ['cards', '卡片'], ['graph', '图谱']]);
/** An open lesson is part of Home. */
export const railSectionOf = section => section === 'lesson' ? 'home' : section;

/** 今天 holds what was touched today and anything still running; the rest is 更早. */
export function lessonGroups(rows, now = new Date(), timeZone) {
  const today = civilDay(now, timeZone), groups = [{ key: 'today', label: '今天', rows: [] }, { key: 'earlier', label: '更早', rows: [] }];
  for (const row of rows) {
    const touched = Number.isFinite(row.updatedAt) ? civilDay(new Date(row.updatedAt), timeZone) : '';
    (row.running || touched === today ? groups[0] : groups[1]).rows.push(row);
  }
  return groups.filter(group => group.rows.length);
}

export function filterByTitle(rows, query, titleOf = row => row.title) {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  return needle ? rows.filter(row => String(titleOf(row) ?? '').toLocaleLowerCase().includes(needle)) : rows;
}

/** Virtual folders only partition the caller's already scoped, visible native sessions. */
export function folderLessons(rows, folders, query = '') {
  const needle = String(query).trim().toLocaleLowerCase(), names = new Map(folders?.groups?.map(group => [group.id, group]) ?? []);
  const membership = new Map((folders?.members ?? []).filter(member => names.has(member.groupId)).map(member => [member.sessionId, member.groupId]));
  const result = [...names.values()].map(group => ({ ...group, rows: [] })), byId = new Map(result.map(group => [group.id, group]));
  const ungrouped = [];
  for (const row of rows) {
    const group = byId.get(membership.get(row.id));
    const matched = !needle || String(row.title || '未命名课堂').toLocaleLowerCase().includes(needle) || !!group?.title.toLocaleLowerCase().includes(needle);
    if (matched) (group ? group.rows : ungrouped).push(row);
  }
  return { folders: needle ? result.filter(group => group.rows.length || group.title.toLocaleLowerCase().includes(needle)) : result, ungrouped };
}

/**
 * The board wants width: entering it folds an open panel, and leaving it
 * unfolds the panel only when the board was what folded it. `pending` tells the
 * next native collapse change apart from one the student made; a change the
 * student made clears everything, so it is never undone.
 */
export function boardCollapse(state, event) {
  if (event.type === 'board') {
    if (event.narrow) return { state: { auto: false, pending: null }, toggle: false };
    if (event.focused && !event.collapsed && !state.auto) return { state: { auto: true, pending: 'collapse' }, toggle: true };
    if (!event.focused && state.auto) return event.collapsed ? { state: { auto: false, pending: 'expand' }, toggle: true } : { state: { auto: false, pending: null }, toggle: false };
    return { state, toggle: false };
  }
  if (event.type === 'collapsed') {
    if (state.pending === 'collapse' && event.collapsed) return { state: { ...state, pending: null }, toggle: false };
    if (state.pending === 'expand' && !event.collapsed) return { state: { auto: false, pending: null }, toggle: false };
    return { state: { auto: false, pending: null }, toggle: false };
  }
  return { state, toggle: false };
}

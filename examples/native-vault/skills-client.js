import manifest from '../../resources/vault-teaching/manifest.json' with { type: 'json' };
import { createVaultClient } from './remote-client.js';
import { filterByTitle } from './rail-data.js';
import { createPanelSearch } from './panel-search-client.js';
import { currentSessionId } from './session-current.js';

/** Fired on the page after the skill catalog changed, so the command menu re-lists it. */
export const SKILLS_CHANGED_EVENT = 'notara:skills-changed';
export const announceSkillsChanged = () => globalThis.dispatchEvent?.(new Event(SKILLS_CHANGED_EVENT));

/** Above this many lines per side the page shows the revision whole instead of diffing. */
export const DIFF_LINE_LIMIT = 2000;

/**
 * Line diff for reviewing a pending revision: longest common subsequence over
 * lines, reported as kept / removed / added rows in reading order.
 */
export function lineDiff(before, after) {
  const a = before === '' ? [] : before.split('\n'), b = after === '' ? [] : after.split('\n');
  if (a.length > DIFF_LINE_LIMIT || b.length > DIFF_LINE_LIMIT) return [{ type: 'fallback', text: after }];
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const rows = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { rows.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) rows.push({ type: 'del', text: a[i++] });
    else rows.push({ type: 'add', text: b[j++] });
  }
  while (i < a.length) rows.push({ type: 'del', text: a[i++] });
  while (j < b.length) rows.push({ type: 'add', text: b[j++] });
  return rows;
}

export function skillStatusLabel(row) {
  if (row.error) return '格式有误';
  const base = row.status === 'active' ? '启用中' : '草稿';
  if (row.overview?.incomplete?.length) return `${base} · 待补全`;
  return row.pending ? `${base} · 有待确认修订` : base;
}

const OVERVIEW_LABELS = [['subjects', '科目'], ['coverage', '学什么'], ['level', '学段或水平'], ['goal', '目标'], ['deadline', '期限']];
/** The overview's required facts in one line, as the student checks them before turning it on. */
export function overviewFacts(overview) {
  return OVERVIEW_LABELS.map(([key, label]) => `${label}：${Array.isArray(overview[key]) ? overview[key].join('、') : overview[key]}`).join(' · ');
}

/** Skills another learning set can inherit: valid ones it does not already have. */
export function inheritChoices(sets, targetId) {
  const target = sets.find(set => set.workspaceId === targetId);
  const taken = new Set((target?.skills ?? []).map(row => row.id));
  return sets.filter(set => set.workspaceId !== targetId).flatMap(set => set.skills
    .filter(row => !row.error && !taken.has(row.id))
    .map(row => ({ value: `${set.workspaceId}/${row.id}`, label: `${set.title} · ${row.title}`, fromWorkspaceId: set.workspaceId, id: row.id })));
}

const CSS = `
.nv-skills{display:grid;gap:18px}
.nv-skills>p,.nv-skill-empty{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.nv-skill-group{display:grid;gap:8px}
.nv-skill-group h3{margin:0;font-size:13px;font-weight:600}
.nv-skill-group h3 small{margin-left:6px;font-weight:400;color:var(--dsw-alias-label-secondary)}
.nv-skill-row{display:grid;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.nv-skill-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.nv-skill-head b{font-size:13px}
.nv-skill-head span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.nv-skill-head [data-status=active]{color:var(--dsw-alias-state-business-primary,#2f6fdf)}
.nv-skill-actions{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.nv-skill-actions button,.nv-skill-inherit button{font-size:12px}
.nv-skill-row pre,.nv-skill-diff{margin:0;max-height:280px;overflow:auto;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-fill-l1,rgba(127,127,127,.08));font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
.nv-skill-diff div[data-type=add]{background:rgba(46,160,67,.14)}
.nv-skill-diff div[data-type=del]{background:rgba(248,81,73,.14);text-decoration:line-through;opacity:.8}
.nv-skill-inherit{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.nv-skill-inherit select{max-width:100%;font-size:12px}
.nv-skill-page{height:100%;overflow:auto;box-sizing:border-box;padding:28px clamp(18px,4cqw,48px) 48px;display:grid;align-content:start;gap:14px;max-width:900px}
.nv-skill-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.nv-skill-head h2{margin:0;font-size:20px;font-weight:600}
.nv-skill-head span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.nv-skill-head [data-status=active]{color:var(--dsw-alias-state-business-primary,#2f6fdf)}
.nv-skill-lead{margin:0;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.nv-skill-error{margin:0;font-size:12px;color:var(--dsw-alias-state-danger-primary,#c0392b)}
.nv-skill-page pre{margin:0;padding:12px 14px;border-radius:8px;background:var(--dsw-alias-fill-l1,rgba(127,127,127,.08));font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
.nv-skill-badge{flex:none;font-size:10.5px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 7px;color:var(--dsw-alias-label-tertiary)}
.nv-skill-badge[data-status=active]{color:var(--dsw-alias-state-success-primary,#3a8a4a);border-color:currentColor}
.nv-skill-badge[data-status=missing]{border-style:dashed}
`;

/** The skills that ship with the teaching resources: read-only, named by their menu titles. */
export const BUILTIN_SKILLS = Object.freeze([...manifest.choices, ...manifest.skills].map(item => Object.freeze({ id: item.id, title: item.title, description: item.description })));
/** One skill in one layer. */
export const skillKey = (row, workspaceId) => row.builtin ? `builtin:${row.id}` : row.scope === 'global' ? `global:${row.id}` : `set:${workspaceId}:${row.id}`;

/** One copy of the skill list for the panel and the page; `load` is `() => vault.userSkills({})`. */
export function createSkillsStore(load) {
  let value = { data: null, error: '', busy: false, selected: '' }, pending = null, generation = 0;
  const listeners = new Set(), publish = patch => { value = { ...value, ...patch }; for (const fn of listeners) fn(); };
  const take = result => { if (!result?.ok) throw new Error(result?.error?.message || '技能暂时读不出来，请稍后再试。'); return result.value; };
  function readSnapshot() {
    if (pending) return pending.promise;
    const flight = { generation, promise: null };
    pending = flight;
    flight.promise = Promise.resolve().then(load).then(result => {
      if (flight.generation === generation) publish({ data: take(result), error: '' });
    }).catch(failure => {
      if (flight.generation === generation) publish({ error: failure.message });
    }).finally(() => { if (pending === flight) pending = null; });
    return flight.promise;
  }
  return {
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => value,
    refresh() { return readSnapshot(); },
    async act(call) {
      if (value.busy) return;
      generation++; pending = null;
      publish({ busy: true });
      try {
        const data = take(await call());
        // Reads admitted before or during the write can describe an older
        // catalog. Invalidate them before publishing its authoritative result.
        generation++; pending = null;
        publish({ data, error: '' }); announceSkillsChanged();
      }
      // Reload after a refused action while retaining its actual error.
      catch (failure) { const message = failure.message; generation++; pending = null; await readSnapshot(); publish({ error: message }); }
      finally { publish({ busy: false }); }
    },
    select(key) { publish({ selected: key }); },
  };
}

const OVERVIEW_ID = 'learning-set';
/** The panel's groups: each learning set (the current one first), the shared tier, then the built-ins. */
export function skillGroups(data, currentWorkspaceId) {
  const sets = [...(data?.sets ?? [])].sort((a, b) => (b.workspaceId === currentWorkspaceId) - (a.workspaceId === currentWorkspaceId));
  const groups = sets.map(set => {
    const rows = [...set.skills].sort((a, b) => (b.id === OVERVIEW_ID) - (a.id === OVERVIEW_ID)).map(row => ({ ...row, scope: 'set', key: skillKey({ ...row, scope: 'set' }, set.workspaceId), workspaceId: set.workspaceId }));
    // A set without its overview still shows the row, so the page can offer to create it.
    if (!set.skills.some(row => row.id === OVERVIEW_ID)) rows.unshift({ id: OVERVIEW_ID, scope: 'set', missing: true, title: '学习集梗概', key: skillKey({ scope: 'set', id: OVERVIEW_ID }, set.workspaceId), workspaceId: set.workspaceId });
    return { key: `set:${set.workspaceId}`, label: `学习集 · ${set.title}`, rows, set };
  });
  groups.push({ key: 'global', label: '学科层 · 所有学习集共用', rows: data?.global ? data.global.skills.map(row => ({ ...row, scope: 'global', key: skillKey({ ...row, scope: 'global' }) })) : [], unavailable: !data?.global });
  groups.push({ key: 'builtin', label: '内置 · 随包的教学技能', rows: BUILTIN_SKILLS.map(row => ({ ...row, builtin: true, key: skillKey({ ...row, builtin: true }) })) });
  return groups;
}

/** The skill panel and page both show: the chosen one while it still exists, else the first. */
export function selectedSkill(groups, key) {
  const rows = groups.flatMap(group => group.rows.map(row => ({ row, group })));
  return rows.find(item => item.row.key === key) ?? rows[0];
}

export function createSkillsPage(React, { navigation, EmptyState, IconButton }) {
  const h = React.createElement, { useState, useEffect, useMemo, useSyncExternalStore } = React;
  const { usePanelSearch, SearchButton, SearchInput } = createPanelSearch(React, { IconButton });
  let store = null;
  const storeFor = ctx => store ??= createSkillsStore(() => createVaultClient(ctx, undefined).userSkills({}));
  function useSkills(ctx) {
    const skills = storeFor(ctx), state = useSyncExternalStore(skills.subscribe, skills.getSnapshot);
    useEffect(() => {
      // Every visit reads again: the teacher may have written a draft or a revision since.
      void skills.refresh();
      const again = () => void skills.refresh();
      window.addEventListener(SKILLS_CHANGED_EVENT, again);
      return () => window.removeEventListener(SKILLS_CHANGED_EVENT, again);
    }, [skills]);
    return [state, skills];
  }
  const useCurrentWorkspace = ctx => {
    const sessions = useSyncExternalStore(fn => ctx.sessions.list.subscribe(fn), () => ctx.sessions.list.getSnapshot());
    const spaces = useSyncExternalStore(fn => ctx.workspaces.list.subscribe(fn), () => ctx.workspaces.list.getSnapshot());
    const directoryId = useSyncExternalStore(navigation.subscribe, () => navigation.getSnapshot().directoryId);
    return (spaces.items ?? []).find(item => item.sessionIds?.includes(currentSessionId(sessions)))?.workspaceId ?? directoryId;
  };

  function SkillsPanel({ ctx, dismiss }) {
    const [state, skills] = useSkills(ctx), current = useCurrentWorkspace(ctx);
    const all = useMemo(() => skillGroups(state.data, current), [state.data, current]);
    const search = usePanelSearch(), searching = !!search.query.trim();
    // While searching, a group without a match is left out altogether.
    const groups = searching ? all.map(group => ({ ...group, rows: filterByTitle(group.rows, search.query, row => row.title ?? row.file) })).filter(group => group.rows.length) : all;
    const selected = selectedSkill(all, state.selected)?.row.key;
    return h(React.Fragment, null, h('style', null, CSS),
      h('div', { className: 'nv-panel-head' }, h('h2', null, '技能'), h(SearchButton, { search })),
      h(SearchInput, { search, label: '搜索技能', placeholder: '按标题找技能…' }),
      h('div', { className: 'nv-panel-scroll', role: 'group', 'aria-label': '技能列表' },
        searching && state.data && !groups.length && h('p', { className: 'nv-panel-note' }, '没有找到这项技能'),
        state.error && h('p', { className: 'nv-panel-note', role: 'alert' }, state.error),
        !state.data && !state.error && h('p', { className: 'nv-panel-note' }, '正在读取…'),
        state.data && groups.map(group => h('section', { key: group.key, className: 'nv-panel-group', 'aria-label': group.label }, h('h3', null, group.label),
          group.unavailable ? h('p', { className: 'nv-panel-note' }, '当前运行环境没有学科层技能目录。')
            : !group.rows.length ? h('p', { className: 'nv-panel-note' }, '还没有技能。老师在调研或上课后会先写成草稿，出现在这里等你确认。')
              : group.rows.map(row => h('button', { key: row.key, type: 'button', className: 'nv-session-row', 'aria-current': selected === row.key ? 'page' : undefined, title: row.title ?? row.file, onClick: () => { skills.select(row.key); navigation.show('skills'); dismiss(); } },
                h('span', null, row.title ?? row.file), !row.builtin && h('small', { className: 'nv-skill-badge', 'data-status': row.missing ? 'missing' : row.status }, row.missing ? '未创建' : skillStatusLabel(row))))))));
  }

  function SkillsView({ ctx }) {
    const [state, skills] = useSkills(ctx), current = useCurrentWorkspace(ctx);
    const vault = useMemo(() => createVaultClient(ctx, undefined), [ctx]);
    const groups = useMemo(() => skillGroups(state.data, current), [state.data, current]);
    const found = selectedSkill(groups, state.selected);
    const [open, setOpen] = useState(''), [pick, setPick] = useState('');
    useEffect(() => { setOpen(''); setPick(''); }, [found?.row.key]);
    const act = (method, input) => skills.act(() => vault[method](input));
    if (!state.data) return h('div', { className: 'nv-skill-page' }, h('style', null, CSS), h('p', { className: state.error ? 'nv-skill-error' : 'nv-skill-empty', role: state.error ? 'alert' : undefined }, state.error || '正在读取…'));
    if (!found) return h('div', { className: 'nv-skill-page' }, h('style', null, CSS), h('p', { className: 'nv-skill-empty' }, '还没有技能。'));
    const { row, group } = found, busy = state.busy;
    const target = row.builtin ? null : { scope: row.scope, id: row.id, ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}) };
    const intro = h('p', { className: 'nv-skill-empty' }, '老师写的技能先是草稿；你读过后启用，老师和工作员才会使用。老师改已启用的技能时，只会生成一份待确认的修订，你采用后才替换原文。');
    // Inheriting is offered on every set, the empty one whose only row is the missing overview included.
    const choices = group.set ? inheritChoices(state.data.sets ?? [], group.set.workspaceId) : [];
    const chosen = choices.find(choice => choice.value === pick);
    const inherit = choices.length > 0 && h('div', { className: 'nv-skill-inherit' },
      h('select', { 'aria-label': `为${group.set.title}继承技能`, value: pick, onChange: event => setPick(event.target.value) },
        h('option', { value: '' }, '从其他学习集继承…'),
        choices.map(choice => h('option', { key: choice.value, value: choice.value }, choice.label))),
      h('button', { type: 'button', className: 'nv-quiet', disabled: busy || !chosen, onClick: () => chosen && act('inheritUserSkill', { fromWorkspaceId: chosen.fromWorkspaceId, toWorkspaceId: group.set.workspaceId, id: chosen.id }) }, '继承为草稿'));
    if (row.missing) return h('div', { className: 'nv-skill-page' }, h('style', null, CSS),
      h(EmptyState, { kind: 'skillsNoOverview', disabled: busy, onAction: [() => act('createLearningSetOverview', { workspaceId: row.workspaceId })] }),
      state.error && h('p', { className: 'nv-skill-error', role: 'alert' }, state.error),
      inherit);
    return h('div', { className: 'nv-skill-page' }, h('style', null, CSS),
      h('header', { className: 'nv-skill-head' },
        h('h2', null, row.title ?? row.file),
        !row.builtin && h('span', { 'data-status': row.status }, skillStatusLabel(row)),
        target && !row.error && h('div', { className: 'nv-skill-actions' },
          row.status === 'draft'
            ? h('button', { type: 'button', className: 'nv-quiet', disabled: busy || Boolean(row.overview?.incomplete?.length), title: row.overview?.incomplete?.length ? '先补全待填写的必填项' : undefined, onClick: () => act('setUserSkillStatus', { ...target, status: 'active', expectedRevision: row.revision }) }, '启用')
            : h('button', { type: 'button', className: 'nv-quiet', disabled: busy, onClick: () => act('setUserSkillStatus', { ...target, status: 'draft', expectedRevision: row.revision }) }, '停用'),
          row.pending && h('button', { type: 'button', className: 'nv-quiet', onClick: () => setOpen(value => value === 'diff' ? '' : 'diff') }, open === 'diff' ? '收起修订' : '查看修订'),
          row.pending && h('button', { type: 'button', className: 'nv-quiet', disabled: busy, onClick: () => act('resolveUserSkillRevision', { ...target, action: 'accept', expectedRevision: row.pending.revision }) }, '采用修订'),
          row.pending && h('button', { type: 'button', className: 'nv-quiet', disabled: busy, onClick: () => act('resolveUserSkillRevision', { ...target, action: 'discard', expectedRevision: row.pending.revision }) }, '丢弃修订'))),
      state.error && h('p', { className: 'nv-skill-error', role: 'alert' }, state.error),
      row.builtin ? h(React.Fragment, null, h('p', { className: 'nv-skill-lead' }, row.description), h('p', { className: 'nv-skill-empty' }, '随包的教学技能，老师按需要自动读取，这里只能查看。'))
        : row.error ? h('p', { className: 'nv-skill-empty' }, '这份文件的页头不完整，老师和工作员都不会使用它；在 Vault 里修正后再启用。')
          : h(React.Fragment, null,
            h('p', { className: 'nv-skill-lead' }, row.overview ? overviewFacts(row.overview) : row.description),
            row.overview?.incomplete?.length > 0 && h('p', { className: 'nv-skill-empty' }, `还有待填写的必填项。在 Vault 的 技能/${row.file} 里补全，或在对话里请老师起草；补全后才能启用。`),
            open === 'diff' && row.pending && h('div', { className: 'nv-skill-diff', role: 'group', 'aria-label': `${row.title}的修订` },
              lineDiff(row.body, row.pending.body).map((line, index) => h('div', { key: index, 'data-type': line.type }, line.type === 'fallback' ? line.text : (line.text || ' ')))),
            h('pre', { 'aria-label': `${row.title}全文` }, row.body)),
      inherit,
      !row.builtin && intro);
  }
  return { SkillsPanel, SkillsView };
}

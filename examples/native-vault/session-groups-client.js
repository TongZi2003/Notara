import { visibleInterval } from './remote-client.js';

const CHANGED = 'notara-session-groups-changed';
const notices = {
  session_groups_conflict: '分组已在其他页面修改，列表已刷新，请再试一次。',
  session_groups_name_duplicate: '这个分组名称已经存在，请换一个名称。',
  session_groups_input_invalid: '请输入有效的分组名称，最多 80 个字符。',
  session_groups_workspace_missing: '学习目录已变更，请重新选择目录。',
  session_groups_group_missing: '这个分组已不存在，列表已刷新。',
  session_groups_session_missing: '这节课已不在当前学习目录，请刷新课堂列表。',
};
function notice(error, fallback = '分组没有保存，请稍后重试。') {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`;
  return Object.entries(notices).find(([code]) => text.includes(code))?.[1] ?? fallback;
}
const unwrap = result => { if (!result.ok) throw result.error; return result.value; };

export function createSessionGroupsUI(React, { Dialog, Icon, IconButton, NativeMenu }) {
  const h = React.createElement, { useState, useEffect, useRef } = React;

  function FolderMenu({ group, disabled, onRename, onDissolve }) {
    const [open, setOpen] = useState(false), [autoFocus, setAutoFocus] = useState(false);
    useEffect(() => {
      setAutoFocus(false);
      if (!open) return;
      const frame = requestAnimationFrame(() => setAutoFocus(true));
      return () => cancelAnimationFrame(frame);
    }, [open]);
    return h(NativeMenu, { open, autoFocus, portal: true, align: 'end', className: 'nv-session-actions', listClassName: 'nv-session-menu',
      anchor: h(IconButton, { icon: 'more', label: `分组操作：${group.title}`, disabled, className: 'nv-icon nv-session-more', 'aria-haspopup': 'menu', 'aria-expanded': open,
        onClick: () => setOpen(value => !value), onKeyDown: event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); } } }),
      items: [{ id: 'rename', label: '重命名分组', icon: h(Icon, { name: 'edit' }) }, { id: 'dissolve', label: '解散分组', icon: h(Icon, { name: 'folder' }) }],
      onClose: () => setOpen(false), onSelect: id => { setOpen(false); (id === 'rename' ? onRename : onDissolve)(group); } });
  }

  function FolderDialog({ target, data, busy, error, onClose, onSave }) {
    const kind = target.kind, moving = kind === 'move', dissolving = kind === 'dissolve';
    const [draft, setDraft] = useState(moving ? data.members.find(member => member.sessionId === target.session.id)?.groupId ?? '' : target.group?.title ?? '');
    const composing = useRef(false);
    const titles = { create: '新建分组', rename: '重命名分组', move: '移动到分组', dissolve: '解散分组' };
    const submit = async event => {
      event.preventDefault();
      if (busy || composing.current || (!moving && !dissolving && !draft.trim())) return;
      const patch = moving ? { kind, sessionId: target.session.id, groupId: draft || null }
        : dissolving ? { kind, groupId: target.group.id }
        : { kind, ...(target.group ? { groupId: target.group.id } : {}), title: draft.trim() };
      if (await onSave(patch)) onClose();
    };
    return h(Dialog, { title: titles[kind], onClose: () => { if (!busy) onClose(); } },
      h('form', { onSubmit: submit },
        dissolving ? h('p', { className: 'nv-session-archive-copy' }, `解散「${target.group.title}」后，里面的对话会回到未分组，课堂记录和资料会保留。`)
          : moving ? h('label', { className: 'nv-session-name' }, `将「${target.session.title || '未命名课堂'}」移到`,
            h('select', { 'aria-label': '目标分组', value: draft, disabled: busy, onChange: event => setDraft(event.target.value) },
              h('option', { value: '' }, '未分组'), data.groups.map(group => h('option', { key: group.id, value: group.id }, group.title))))
          : h('label', { className: 'nv-session-name' }, '分组名称', h('input', { 'aria-label': '分组名称', value: draft, maxLength: 80, disabled: busy, autoComplete: 'off',
            onChange: event => setDraft(event.target.value), onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; },
            onKeyDown: event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); } })),
        error && h('p', { role: 'alert', className: 'nv-delete-error' }, error),
        h('div', { className: 'nv-delete-actions' },
          h('button', { type: 'button', className: 'nv-quiet', disabled: busy, onClick: onClose }, '取消'),
          h('button', { type: 'submit', className: 'nv-quiet', disabled: busy || (!moving && !dissolving && !draft.trim()) }, busy ? '正在保存…' : dissolving ? '解散' : '保存'))));
  }

  function useSessionGroups(ctx, workspaceId) {
    const [data, setData] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [readError, setReadError] = useState(''), [target, setTarget] = useState(null);
    const scope = useRef(null), epoch = useRef(0), sequence = useRef(0), pending = useRef(false);
    const accept = (value, id, ticket, generation) => {
      if (scope.current !== id || epoch.current !== generation || sequence.current !== ticket) return;
      setData(previous => !previous || previous.workspaceId !== id || value.revision >= previous.revision ? value : previous);
    };
    const refresh = async (generation = epoch.current) => {
      if (!workspaceId || scope.current !== workspaceId || epoch.current !== generation || pending.current) return;
      const ticket = ++sequence.current;
      try {
        const value = unwrap(await ctx.remote.notaraVault.sessionGroups({ workspaceId }));
        if (scope.current !== workspaceId || epoch.current !== generation || sequence.current !== ticket) return;
        accept(value, workspaceId, ticket, generation); setReadError('');
      }
      catch (reason) { if (scope.current === workspaceId && epoch.current === generation && sequence.current === ticket) setReadError(notice(reason, '分组列表没有读取，请稍后重试。')); }
    };
    useEffect(() => {
      scope.current = workspaceId;
      const generation = ++epoch.current;
      setData(null); setTarget(null); setError(''); setReadError(''); setBusy(false); pending.current = false;
      void refresh(generation);
      const changed = event => { if (event.detail?.workspaceId === workspaceId) void refresh(generation); };
      const focused = () => { void refresh(generation); };
      window.addEventListener(CHANGED, changed); window.addEventListener('focus', focused);
      const stop = visibleInterval(() => { void refresh(generation); }, 15_000);
      return () => { scope.current = null; epoch.current++; sequence.current++; stop(); window.removeEventListener(CHANGED, changed); window.removeEventListener('focus', focused); };
    }, [ctx, workspaceId]);
    const mutate = async patch => {
      if (pending.current || data?.workspaceId !== workspaceId) return false;
      const generation = epoch.current, current = () => scope.current === workspaceId && epoch.current === generation;
      pending.current = true; setBusy(true); setError('');
      const ticket = ++sequence.current;
      try {
        const result = unwrap(await ctx.remote.notaraVault.mutateSessionGroups({ workspaceId, expectedRevision: data.revision, patch }));
        if (!current()) return false;
        accept(result, workspaceId, ticket, generation);
        window.dispatchEvent(new CustomEvent(CHANGED, { detail: { workspaceId } }));
        return true;
      } catch (reason) {
        if (!current()) return false;
        setError(notice(reason));
        pending.current = false;
        await refresh(generation);
        return false;
      } finally { if (current()) { pending.current = false; setBusy(false); } }
    };
    const open = value => { if (!busy && data?.workspaceId === workspaceId) { setError(''); setTarget(value); } };
    const ready = data?.workspaceId === workspaceId;
    return {
      data: ready ? data : null, busy, ready, FolderMenu,
      create: () => open({ kind: 'create' }), rename: group => open({ kind: 'rename', group }), dissolve: group => open({ kind: 'dissolve', group }), move: session => open({ kind: 'move', session }),
      status: !target && (error || readError) ? h('p', { role: 'alert', className: 'nv-delete-error' }, error || readError, h('button', { type: 'button', className: 'nv-quiet', onClick: () => { setError(''); setReadError(''); void refresh(); } }, '重试')) : null,
      overlay: target && ready ? h(FolderDialog, { key: `${target.kind}:${target.group?.id ?? target.session?.id ?? ''}`, target, data, busy, error: error || readError, onClose: () => setTarget(null), onSave: mutate }) : null,
    };
  }
  return { useSessionGroups };
}

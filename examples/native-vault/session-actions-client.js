import { currentSessionId } from './session-current.js';

const titleOf = row => row.title || '未命名课堂';

/** UI actions use the native session projection and archive lifecycle. */
export function createSessionActionsUI(React, { Dialog, IconButton, Icon, NativeMenu }) {
  const h = React.createElement, { useState, useRef, useEffect } = React;

  function SessionMenu({ session, disabled, onRename, onArchive, onDelete, onMove }) {
    const [open, setOpen] = useState(false), [autoFocus, setAutoFocus] = useState(false);
    useEffect(() => {
      setAutoFocus(false);
      if (!open) return;
      // The native portal measures a hidden card first; focus it after placement.
      const frame = requestAnimationFrame(() => setAutoFocus(true));
      return () => cancelAnimationFrame(frame);
    }, [open]);
    return h(NativeMenu, { open, autoFocus, portal: true, align: 'end', className: 'nv-session-actions', listClassName: 'nv-session-menu',
      anchor: h(IconButton, { icon: 'more', label: `对话操作：${titleOf(session)}`, className: 'nv-icon nv-session-more', disabled, 'aria-haspopup': 'menu', 'aria-expanded': open,
        onClick: () => setOpen(value => !value), onKeyDown: event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); } } }),
      items: [
        { id: 'rename', label: '重命名', icon: h(Icon, { name: 'edit' }) },
        { id: 'archive', label: '归档对话', icon: h(Icon, { name: 'archive' }) },
        ...(onMove ? [{ id: 'move', label: '移动到分组', icon: h(Icon, { name: 'folder' }) }] : []),
        { id: 'delete', label: '删除对话', icon: h(Icon, { name: 'trash' }), danger: true, disabled: !!session.running },
      ], onClose: () => setOpen(false), onSelect: id => { setOpen(false); ({ rename: onRename, archive: onArchive, delete: onDelete, move: onMove })[id]?.(session); } });
  }

  function RenameDialog({ ctx, session, onClose }) {
    const [draft, setDraft] = useState(session.title || ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const pending = useRef(false), composing = useRef(false);
    const close = () => { if (!pending.current) onClose(); };
    const confirm = async event => {
      event.preventDefault(); if (pending.current || composing.current || !draft.trim()) return;
      pending.current = true; setBusy(true); setError('');
      try {
        const result = await ctx.sessions.using(session.id, { source: 'workspaceOperation' }, reference => reference.binding.session.rename(draft.trim()));
        if (!result.ok) throw new Error(result.error?.code === 'session/title-invalid' ? '请输入有效的对话名称。' : '对话名称未保存，请稍后重试。');
        onClose();
      } catch (reason) { setError(reason.message === '请输入有效的对话名称。' ? reason.message : '对话名称未保存，请稍后重试。'); }
      finally { pending.current = false; setBusy(false); }
    };
    return h(Dialog, { title: '重命名对话', onClose: close },
      h('form', { onSubmit: confirm },
        h('label', { className: 'nv-session-name' }, '对话名称', h('input', { 'aria-label': '对话名称', value: draft, disabled: busy, autoComplete: 'off', onFocus: event => event.target.select(), onChange: event => { setDraft(event.target.value); setError(''); }, onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; }, onKeyDown: event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); } })),
        error && h('p', { role: 'alert', className: 'nv-delete-error' }, error),
        h('div', { className: 'nv-delete-actions' }, h('button', { type: 'button', className: 'nv-quiet', disabled: busy, onClick: close }, '取消'), h('button', { type: 'submit', className: 'nv-quiet', disabled: busy || !draft.trim() }, busy ? '正在保存…' : '保存'))));
  }

  function useSessionActions(ctx, navigation) {
    const [rename, setRename] = useState(null), [confirmation, setConfirmation] = useState(null), [notice, setNotice] = useState(null), [error, setError] = useState(''), [busyId, setBusyId] = useState(null);
    const pending = useRef(false), live = useRef(true);
    useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    const archive = async (row, stopActivity = false) => {
      if (pending.current) return;
      pending.current = true; setBusyId(row.id); setError('');
      const before = currentSessionId(ctx.sessions.list.getSnapshot()), serial = navigation.getSnapshot().serial;
      const directory = ctx.workspaces.list.getSnapshot().items.find(item => item.sessionIds?.includes(row.id));
      try {
        await ctx.uiWorkspace.archiveSession(row.id, stopActivity ? { stopActivity: true } : undefined);
        if (live.current) { setConfirmation(null); setNotice({ id: row.id, title: titleOf(row) }); }
        // A delayed reply must not move a student who has opened another lesson.
        if (before === row.id && !currentSessionId(ctx.sessions.list.getSnapshot()) && navigation.getSnapshot().serial === serial && navigation.getSnapshot().section === 'lesson') {
          if (directory) navigation.rememberDirectory(directory.workspaceId);
          navigation.show('home'); void navigation.prepareHome(ctx);
        }
      } catch (reason) {
        if (!live.current) return;
        const activity = reason?.rpcError?.details?.activity;
        if (!stopActivity && reason?.rpcError?.code === 'workspace/session-active' && Array.isArray(activity)) setConfirmation({ row, count: activity.length });
        else setError('对话未归档，请稍后重试。');
      } finally { pending.current = false; if (live.current) setBusyId(null); }
    };
    const undo = async () => {
      if (pending.current || !notice) return;
      pending.current = true; setBusyId(notice.id); setError('');
      try { await ctx.uiWorkspace.unarchiveSession(notice.id); if (live.current) setNotice(null); }
      catch { if (live.current) setError('暂时无法取消归档，可以稍后重试。'); }
      finally { pending.current = false; if (live.current) setBusyId(null); }
    };
    const overlay = h(React.Fragment, null,
      rename && h(RenameDialog, { key: rename.id, ctx, session: rename, onClose: () => setRename(null) }),
      confirmation && h(Dialog, { title: '停止并归档对话？', onClose: () => { if (!pending.current) { setConfirmation(null); setError(''); } } },
        h('p', { className: 'nv-session-archive-copy' }, `「${titleOf(confirmation.row)}」仍有 ${confirmation.count} 项工作在运行。继续会停止这些工作并归档对话；记录会保留，可以取消归档。`),
        error && h('p', { role: 'alert', className: 'nv-delete-error' }, error),
        h('div', { className: 'nv-delete-actions' }, h('button', { type: 'button', className: 'nv-quiet', disabled: !!busyId, onClick: () => { setConfirmation(null); setError(''); } }, '取消'), h('button', { type: 'button', className: 'nv-quiet', disabled: !!busyId, onClick: () => archive(confirmation.row, true) }, busyId ? '正在归档…' : '停止并归档'))));
    const status = h(React.Fragment, null,
      notice && h('div', { className: 'nv-session-archive-notice' }, h('span', { role: 'status' }, `「${notice.title}」已归档`), h('button', { type: 'button', className: 'nv-quiet', disabled: !!busyId, onClick: undo }, '撤销归档'), h(IconButton, { icon: 'close', label: '关闭归档提示', disabled: !!busyId, onClick: () => setNotice(null) })),
      error && !confirmation && h('p', { role: 'alert', className: 'nv-delete-error' }, error));
    return { SessionMenu, rename: row => { setError(''); setRename(row); }, archive, busyId, overlay, status };
  }
  return { useSessionActions };
}

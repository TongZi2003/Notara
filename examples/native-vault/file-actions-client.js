const errorText = error => {
  const code = String(error?.message ?? error?.code ?? error ?? '');
  if (/revision_conflict/.test(code)) return '文件已被修改，请重新打开删除菜单后再试。';
  if (/restore_conflict/.test(code)) return '原位置已有同名文件，不能覆盖。请先处理同名文件再恢复。';
  if (/restore_unavailable/.test(code)) return '现在无法恢复，资料仍保留在回收站。';
  if (/file_not_found/.test(code)) return '文件已经移动或删除，请刷新文件列表。';
  return '操作未完成，文件仍保留；请刷新后重试。';
};

export function createFileActions(React, { STYLE, Dialog }) {
  const h = React.createElement;
  return function useFileActions(vault) {
    const [pending, setPending] = React.useState(null), [trash, setTrash] = React.useState(null);
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
    const allows = path => window.dispatchEvent(new CustomEvent('notara-vault-before-trash', { cancelable: true, detail: { path, sessionId: vault.sessionId } }));
    const changed = (path, action) => {
      window.dispatchEvent(new CustomEvent('notara-vault-files-changed', { detail: { path, action, sessionId: vault.sessionId } }));
      window.dispatchEvent(new Event('notara-vault-changed'));
    };
    const requestDelete = async path => {
      if (busy) return;
      setError(''); setPending({ path }); setBusy(true);
      try {
        if (!allows(path)) throw new Error('unsaved');
        const result = await vault.list({});
        if (!result.ok) throw result.error;
        const file = result.value.files.find(item => item.path === path);
        if (!file?.revision) throw new Error('vault_file_not_found');
        setPending(file);
      } catch (error) { setError(error.message === 'unsaved' ? '这个文件有未保存修改，请先保存或放弃修改。' : errorText(error)); }
      finally { setBusy(false); }
    };
    const confirmDelete = async () => {
      if (busy || !pending?.revision) return;
      if (!allows(pending.path)) { setError('这个文件有未保存修改，请先保存或放弃修改。'); return; }
      setBusy(true); setError('');
      try {
        const result = await vault.trashFile({ path: pending.path, expectedRevision: pending.revision });
        if (!result.ok) throw result.error;
        changed(pending.path, 'trashed'); setPending(null);
      } catch (error) { setError(errorText(error)); }
      finally { setBusy(false); }
    };
    const showTrash = async () => {
      setTrash([]); setError(''); setBusy(true);
      try { const result = await vault.listTrash({}); if (!result.ok) throw result.error; setTrash(result.value.items); }
      catch (error) { setError(errorText(error)); }
      finally { setBusy(false); }
    };
    const restore = async item => {
      if (busy) return;
      setBusy(true); setError('');
      try {
        const result = await vault.restoreFile({ id: item.id });
        if (!result.ok) throw result.error;
        setTrash(items => items.filter(row => row.id !== item.id)); changed(result.value.path, 'restored');
      } catch (error) { setError(errorText(error)); }
      finally { setBusy(false); }
    };
    const dialog = pending ? h(Dialog, { title: '移到回收站', onClose: () => !busy && setPending(null) },
      h('p', { style: { overflowWrap: 'anywhere' } }, pending.path),
      h('p', { style: STYLE.notice }, '可从文件列表的回收站恢复。引用此文件的笔记会保留。'),
      error && h('p', { role: 'alert', style: STYLE.notice }, error),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 } },
        h('button', { style: STYLE.quiet, disabled: busy, onClick: () => setPending(null) }, '取消'),
        h('button', { style: STYLE.quiet, disabled: busy || !pending.revision, onClick: confirmDelete }, busy ? '处理中…' : '移到回收站'))) :
      trash !== null ? h(Dialog, { title: '回收站', onClose: () => !busy && setTrash(null) },
        error && h('p', { role: 'alert', style: STYLE.notice }, error),
        !trash.length && h('p', { style: STYLE.notice }, busy ? '正在读取…' : '回收站是空的。'),
        h('div', { style: { display: 'grid', gap: 10, marginTop: 16 } }, trash.map(item => h('div', { key: item.id, style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('span', { style: { flex: 1, overflowWrap: 'anywhere', fontSize: 13 } }, item.path),
          h('button', { style: STYLE.quiet, disabled: busy, onClick: () => restore(item), 'aria-label': `恢复 ${item.path}` }, '恢复'))))) : null;
    return { requestDelete, showTrash, dialog };
  };
}

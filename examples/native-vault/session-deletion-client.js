export const SESSION_DELETION_METHODS = Object.freeze(['previewDeletion', 'deleteConversation']);

export function sessionDeletionRemoteDescriptors(strictJsonSchema) {
  return SESSION_DELETION_METHODS.map(method => ({
    id: `@notara/vault-native#notaraSession/${method}`,
    service: 'notaraSession', namespace: 'notaraSession', method,
    invocation: { kind: 'direct' },
    parameters: [{ name: 'input', wire: 'input', source: 'json', codec: { mode: 'strict', typeSymbol: '@notara/vault-native#JsonObject', create: () => strictJsonSchema } }],
    result: { mode: 'strict', typeSymbol: '@notara/vault-native#JsonValue', create: () => strictJsonSchema },
  }));
}

function deletionError(error) {
  const code = error?.message ?? '';
  if (code.includes('session_delete_active')) return '这节课或关联的工作员仍在运行。请先让它们结束，再重新发起删除。';
  if (code.includes('session_delete_confirmation_stale') || code.includes('session_delete_confirmation_expired')) return '课堂内容已变化或确认已过期，请重新打开删除确认。';
  if (code.includes('session_delete_title_mismatch')) return '输入的课堂名称不一致。';
  if (code.includes('session_delete_session_reading')) return '这节课正在被读取，请稍后再试。';
  if (code.includes('session_delete_in_progress')) return '这节课正在处理中，请稍后再试。';
  return '暂时无法安全删除这节课，请稍后重试。';
}

function unwrapDeletionResult(result) {
  if (result?.ok) return result.value;
  throw new Error(result?.error?.message ?? result?.error?.code ?? 'session_delete_failed');
}

export function createSessionDeletionUI(React, { Dialog, IconButton }) {
  const h = React.createElement;
  const { useEffect, useState } = React;

  function DeleteSessionDialog({ ctx, session, onClose, onDeleted }) {
    const [preview, setPreview] = useState(null), [typedTitle, setTypedTitle] = useState(''), [acknowledged, setAcknowledged] = useState(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => {
      let live = true;
      ctx.remote.notaraSession.previewDeletion({ sessionId: session.id }).then(unwrapDeletionResult).then(value => {
        if (live) setPreview(value);
      }).catch(reason => {
        if (live) setError(deletionError(reason));
      });
      return () => { live = false; };
    }, [ctx, session.id]);
    const close = () => { if (!busy) onClose(); };
    const confirm = async () => {
      if (!preview || typedTitle !== preview.title || !acknowledged || busy) return;
      setBusy(true); setError('');
      try {
        const result = unwrapDeletionResult(await ctx.remote.notaraSession.deleteConversation({ sessionId: session.id, token: preview.token, typedTitle }));
        await onDeleted(result);
      } catch (reason) {
        setError(deletionError(reason));
        setPreview(null);
        setTypedTitle(''); setAcknowledged(false);
        // Require a fresh snapshot and confirmation after any refused attempt.
        try { setPreview(unwrapDeletionResult(await ctx.remote.notaraSession.previewDeletion({ sessionId: session.id }))); }
        catch (refreshError) { setError(deletionError(refreshError)); }
      } finally { setBusy(false); }
    };
    return h(Dialog, { title: '永久删除课堂', onClose: close },
      !preview && !error && h('p', { className: 'nv-delete-status' }, '正在检查课堂及关联记录…'),
      preview && h(React.Fragment, null,
        h('p', { className: 'nv-delete-warning' }, h('strong', null, `将永久删除「${preview.title}」的对话记录。`), ' 此操作不能撤销，也不会进入 Vault 回收站。'),
        preview.linkedSessions.length > 0 && h('section', { className: 'nv-delete-linked', 'aria-label': '同时删除的关联记录' },
          h('p', null, `还会删除 ${preview.linkedSessions.length} 条关联的子会话记录：`),
          h('ul', null, preview.linkedSessions.map((child, index) => h('li', { key: `${child.title}-${index}` }, child.title, child.worker ? '（工作员）' : '（关联课堂）')))),
        h('p', { className: 'nv-delete-preserved' }, 'Vault 资料、白板、路线和卡片会保留；共享附件也会保留，以免影响其他课堂。'),
        h('label', { className: 'nv-delete-name-label' }, '输入课堂名称以确认删除',
          h('input', { 'aria-label': '输入课堂名称以确认删除', value: typedTitle, disabled: busy, autoComplete: 'off', onChange: event => setTypedTitle(event.target.value) })),
        h('label', { className: 'nv-delete-ack' },
          h('input', { type: 'checkbox', checked: acknowledged, disabled: busy, onChange: event => setAcknowledged(event.target.checked) }),
          '我了解这会永久删除此课堂和上面的关联记录。')),
      error && h('p', { role: 'alert', className: 'nv-delete-error' }, error),
      h('div', { className: 'nv-delete-actions' },
        h('button', { type: 'button', className: 'nv-quiet', disabled: busy, onClick: close }, '取消'),
        h('button', { type: 'button', className: 'nv-danger', disabled: !preview || busy || typedTitle !== preview.title || !acknowledged, onClick: confirm }, busy ? '正在删除…' : '永久删除')));
  }

  return { DeleteSessionDialog };
}

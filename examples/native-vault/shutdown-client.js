const CSS = `
.nv-icon.nv-shutdown-trigger{width:42px;height:42px;color:var(--dsw-alias-state-error-primary,#d84949)!important}
.nv-icon.nv-shutdown-trigger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84949) 12%,transparent)}
.nv-shutdown-copy{margin:16px 0 8px;line-height:1.8;color:var(--dsw-alias-label-primary)}
.nv-shutdown-help{margin:8px 0;line-height:1.8;color:var(--dsw-alias-label-secondary)}
.nv-shutdown-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
.nv-shutdown-error{color:var(--dsw-alias-state-error-primary,#d84949);line-height:1.7}
`;

export function createShutdownUI(React, { Dialog, IconButton }) {
  const h = React.createElement;
  function useVaultShutdown(ctx) {
    const [phase, setPhase] = React.useState('closed'), [error, setError] = React.useState('');
    const pending = React.useRef(false);
    const close = () => { if (!pending.current && phase !== 'requested') { setPhase('closed'); setError(''); } };
    const confirm = async () => {
      if (pending.current) return;
      pending.current = true; setPhase('stopping'); setError('');
      try {
        const result = await ctx.remote.notaraVault.shutdown({});
        if (!result?.ok || result.value?.phase !== 'stopping') throw new Error(result?.error?.message ?? '');
        setPhase('requested');
      } catch (reason) {
        const message = reason?.message ?? '';
        setError(/^(当前启动方式|更新正在重启|Notara 正在关闭)/.test(message) ? message : '关闭请求未完成，请检查连接后重试。');
        setPhase('confirm');
      } finally { pending.current = false; }
    };
    return {
      button: h(IconButton, { icon: 'power', label: '关闭 Notara「拾页」', className: 'nv-icon nv-shutdown-trigger', onClick: () => { setError(''); setPhase('confirm'); } }),
      dialog: h(React.Fragment, null, h('style', null, CSS), phase !== 'closed' && h(Dialog, { title: phase === 'requested' ? '已请求关闭 Notara「拾页」' : '关闭 Notara「拾页」', onClose: close },
        h('p', { className: 'nv-shutdown-copy', role: phase === 'requested' ? 'status' : undefined }, phase === 'requested' ? '正在停止 Notara 服务，课堂和资料会保留。' : '是否要关闭 Notara「拾页」？'),
        h('p', { className: 'nv-shutdown-help' }, phase === 'requested' ? '你可以关闭这个页面。继续学习时，双击桌面的 Notara「拾页」重新打开。' : '正在进行的回复和后台任务也会停止，课堂和资料会保留。'),
        error && h('p', { role: 'alert', className: 'nv-shutdown-error' }, error),
        phase !== 'requested' && h('div', { className: 'nv-shutdown-actions' },
          h('button', { type: 'button', className: 'nv-quiet', disabled: phase === 'stopping', onClick: close }, '取消'),
          h('button', { type: 'button', className: 'nv-danger', disabled: phase === 'stopping', onClick: confirm }, phase === 'stopping' ? '正在关闭…' : '确定'))))
    };
  }
  return { useVaultShutdown };
}

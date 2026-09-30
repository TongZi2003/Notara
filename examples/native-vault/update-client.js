/** One updater state per mounted plugin, shared by the notice and settings. */
export function createUpdateUI(React) {
  const h = React.createElement;
  let state = { phase: 'current', message: '正在读取更新状态…' }, ctx, timer, closed = false, fetching = false, restartAt = 0;
  const listeners = new Set();
  const set = value => { state = value; for (const listener of listeners) listener(); };
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const snapshot = () => state;
  const valueOf = result => {
    if (!result?.ok) {
      const message = result?.error?.message ?? '';
      throw new Error(/^(课堂或|暂时无法确认课堂|当前启动器|新版尚未|更新服务)/.test(message) ? message : '更新操作未完成，请稍后重试。');
    }
    return result.value;
  };
  // The normal native Remote context is disposed when its Host goes away.
  // HTTP remains usable during the restart and after the new Host is ready.
  const call = async method => {
    const response = await fetch(`/api/notaraVault/${method}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `notaraVault/${method}`, payload: { args: { input: {} } } }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('更新服务暂时不可用，请稍后重试。');
    return valueOf((await response.json()).result);
  };
  let recovering = false;
  async function recover(version) {
    if (recovering) return; recovering = true;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const value = await call('updateStatus');
        if ((value.phase === 'current' && value.currentVersion !== version) || value.phase === 'error') { window.location.reload(); return; }
      } catch { /* The old process has stopped; retry the same authenticated origin. */ }
      await new Promise(done => setTimeout(done, 1500));
    }
    window.location.reload();
  }
  async function refresh() {
    if (closed || fetching || document.hidden) return;
    fetching = true;
    try {
      const value = await call('updateStatus');
      if (closed) return;
      if (restartAt && value.phase === 'current' && value.currentVersion !== state.currentVersion) { window.location.reload(); return; }
      if (value.phase === 'restarting') void recover(value.currentVersion);
      if (!restartAt || value.phase !== 'ready' || Date.now() - restartAt > 1500) set({ ...value, ...(state.actionError ? { actionError: state.actionError } : {}) });
      if (value.phase === 'error' || value.phase === 'current') restartAt = 0;
    } catch {
      if (restartAt && Date.now() - restartAt > 120_000) set({ ...state, phase: 'error', message: '服务暂时没有恢复，请查看启动终端；恢复后可以刷新继续学习。' });
    } finally {
      fetching = false;
      if (!closed) timer = setTimeout(refresh, ['checking', 'downloading', 'restarting'].includes(state.phase) ? 1500 : 30_000);
    }
  }
  async function check() {
    try { set(await call('checkUpdate')); clearTimeout(timer); void refresh(); }
    catch (error) { set({ ...state, phase: 'error', message: error.message }); }
  }
  async function apply() {
    const previous = state;
    restartAt = Date.now(); set({ ...state, phase: 'restarting', message: '正在重启更新，请保持页面打开…' });
    try { set(await call('applyUpdate')); void recover(previous.currentVersion); clearTimeout(timer); void refresh(); }
    catch (error) { restartAt = 0; set({ ...previous, actionError: error.message }); }
  }
  const buttonStyle = { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 7, padding: '6px 10px', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', font: 'inherit', cursor: 'pointer' };
  function Controls({ compact = false }) {
    const value = React.useSyncExternalStore(subscribe, snapshot);
    const native = React.useSyncExternalStore(listener => ctx.sessions.list.subscribe(listener), () => ctx.sessions.list.getSnapshot());
    const busy = Object.values(native.byId).some(row => row.running);
    if (compact && !['ready', 'downloading', 'manual', 'restarting'].includes(value.phase)) return null;
    return h('div', { className: 'nv-update', 'aria-label': 'Notara 更新', style: { fontSize: 12, padding: compact ? '8px 16px' : '12px 0', borderTop: compact ? '1px solid var(--dsw-alias-border-l1)' : undefined } },
      value.latestVersion && h('b', null, `有新版本 ${value.latestVersion}`),
      h('p', { role: 'status', style: { margin: '6px 0', color: 'var(--dsw-alias-label-secondary)' } }, value.message),
      value.actionError && h('p', { role: 'alert' }, value.actionError),
      value.phase === 'ready' && h('button', { type: 'button', style: buttonStyle, disabled: busy, onClick: () => { void apply(); } }, busy ? '课堂结束后可更新' : '重启并更新'),
      !compact && !['checking', 'downloading', 'restarting', 'unsupported'].includes(value.phase) && h('button', { type: 'button', style: { ...buttonStyle, marginLeft: value.phase === 'ready' ? 8 : 0 }, onClick: () => { void check(); } }, '检查更新'),
      value.releaseUrl && h('a', { href: value.releaseUrl, target: '_blank', rel: 'noreferrer', style: { display: 'inline-block', margin: '8px 0 0 10px', color: 'inherit' } }, '发布说明'));
  }
  function UpdateSettings() {
    const value = React.useSyncExternalStore(subscribe, snapshot);
    return h('section', { style: { padding: '16px 0' } }, h('h2', { style: { fontSize: 16 } }, '更新'),
      h('p', null, value.currentVersion ? `当前版本 ${value.currentVersion}` : 'Notara'), h(Controls),
      h('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '自动检查正式版本并在后台准备。点击更新后保留课堂、资料与设置，重新打开当前学习空间。'));
  }
  function install(scope) {
    ctx = scope; closed = false;
    scope.effect(() => {
      void refresh();
      const show = () => { if (!document.hidden) { clearTimeout(timer); void refresh(); } };
      document.addEventListener('visibilitychange', show);
      return () => { closed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', show); };
    });
    scope.effect(() => scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'notara.updates', order: 36, label: '更新' }, UpdateSettings)));
  }
  return { install, UpdateNotice: () => h(Controls, { compact: true }) };
}

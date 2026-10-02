const DISMISS_KEY = 'notara.updates.dismissed';
const NOTICE_PHASES = ['downloading', 'ready', 'manual', 'restarting', 'error'];
const PENDING_PHASES = ['checking', 'downloading', 'restarting'];
const CSS = `
.nv-update{font:13px/1.65 var(--dsw-font-family);color:var(--dsw-alias-label-primary)}
.nv-update p{margin:8px 0;color:var(--dsw-alias-label-secondary)}
.nv-update [role=alert]{color:var(--dsw-alias-label-primary)}
.nv-update-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}
.nv-update button{font:inherit;color:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--nv-control-radius,10px);padding:7px 12px;background:var(--dsw-alias-bg-layer-1)}
.nv-update button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nv-update button:disabled{opacity:.55;cursor:default}
.nv-update button:focus-visible,.nv-update a:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:3px}
.nv-update button[data-primary]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent}
.nv-update a{color:var(--dsw-alias-label-secondary);text-decoration:underline;text-underline-offset:3px}
.nv-update-toast{position:fixed;top:max(64px,env(safe-area-inset-top));right:max(20px,env(safe-area-inset-right));width:360px;max-width:calc(100vw - 32px);box-sizing:border-box;max-height:calc(100dvh - 88px);overflow:auto;pointer-events:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--nv-card-radius,14px);box-shadow:var(--nv-shadow-md,0 8px 24px #0002);padding:18px;overflow-wrap:anywhere}
.nv-update-toast header{display:flex;gap:12px;align-items:flex-start}
.nv-update-toast h2{font-size:14px;font-weight:600;line-height:1.5;margin:0}
.nv-update-toast small{display:block;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:3px}
.nv-update-mark{display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:var(--nv-control-radius,10px);background:var(--dsw-alias-bg-layer-2)}
.nv-update-toast .nv-update-close{display:grid;place-items:center;flex:none;padding:5px;margin:-5px -5px 0 auto;border:0;background:transparent}
.nv-update svg{width:18px;height:18px;display:block}
.nv-update-settings{padding:16px 0}.nv-update-settings h2{font-size:16px;margin-top:0}
.nv-update-help{font-size:12px;margin-top:20px!important}
@media(max-width:600px){.nv-update-toast{right:max(12px,env(safe-area-inset-right));max-width:calc(100vw - 24px);padding:16px}}
`;

/** Browser reads never trigger a release check. The launcher owns that lifecycle. */
export function createUpdateUI(React) {
  const h = React.createElement;
  let state = { phase: 'current', message: '正在读取更新状态…' }, ctx, timer, closed = true;
  let fetching = false, acting = false, restartAt = 0, generation = 0, request = 0;
  let lifetime, recovering = false, dismissed;
  const pageLaunch = crypto.randomUUID();
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  const set = value => { state = value; emit(); };
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const snapshot = () => state;
  const noticeKey = () => `${state.launchId || pageLaunch}:${state.latestVersion || state.currentVersion || 'check'}`;
  const visible = () => NOTICE_PHASES.includes(state.phase) && dismissed !== noticeKey();
  const readDismissed = () => { try { dismissed = localStorage.getItem(DISMISS_KEY); } catch { /* keep the in-memory choice when storage is unavailable */ } };
  function dismiss() {
    dismissed = noticeKey();
    try { localStorage.setItem(DISMISS_KEY, dismissed); } catch { /* closing also works in private mode */ }
    emit();
  }
  const valueOf = result => {
    if (!result?.ok) {
      const message = result?.error?.message ?? '';
      throw new Error(/^(课堂或|暂时无法确认课堂|当前启动器|新版尚未|更新服务)/.test(message) ? message : '更新操作未完成，请稍后重试。');
    }
    return result.value;
  };
  // The native Remote context is disposed during a Host restart. Same-origin
  // HTTP can still observe the replacement Host and restore the current page.
  const call = async (method, signal) => {
    const response = await fetch(`/api/notaraVault/${method}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `notaraVault/${method}`, payload: { args: { input: {} } } }),
      signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) });
    if (!response.ok) throw new Error('更新服务暂时不可用，请稍后重试。');
    return valueOf((await response.json()).result);
  };
  async function recover(version) {
    if (recovering) return; recovering = true;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const value = await call('updateStatus');
        if ((value.phase === 'current' && value.currentVersion !== version) || value.phase === 'error') { window.location.reload(); return; }
      } catch { /* The old process stopped; retry this authenticated origin. */ }
      await new Promise(done => setTimeout(done, 1500));
    }
    window.location.reload();
  }
  function schedule(delay = PENDING_PHASES.includes(state.phase) ? 1500 : 30_000) {
    clearTimeout(timer);
    if (!closed) timer = setTimeout(refresh, delay);
  }
  async function refresh() {
    if (closed) return;
    if (fetching || acting || document.hidden) { schedule(); return; }
    const run = generation, id = ++request;
    fetching = true;
    try {
      const value = await call('updateStatus', lifetime.signal);
      if (closed || run !== generation || id !== request) return;
      if (restartAt && value.phase === 'current' && value.currentVersion !== state.currentVersion) { window.location.reload(); return; }
      if (value.phase === 'restarting') void recover(value.currentVersion);
      if (!restartAt || value.phase !== 'ready' || Date.now() - restartAt > 1500) set({ ...value, ...(state.actionError ? { actionError: state.actionError } : {}) });
      if (value.phase === 'error' || value.phase === 'current') restartAt = 0;
    } catch {
      if (!closed && run === generation && id === request) {
        if (restartAt && Date.now() - restartAt > 120_000) set({ ...state, phase: 'error', message: '服务暂时没有恢复，请查看启动终端；恢复后可以刷新继续学习。' });
        else if (!restartAt) set({ ...state, statusError: '更新状态暂时无法读取，稍后会自动重试。' });
      }
    } finally {
      if (run === generation) { fetching = false; schedule(); }
    }
  }
  async function action(method) {
    if (closed || acting) return;
    const run = generation, id = ++request, previous = state;
    acting = true; clearTimeout(timer);
    if (method === 'applyUpdate') restartAt = Date.now();
    set({ ...state, actionError: undefined, statusError: undefined, phase: method === 'applyUpdate' ? 'restarting' : 'checking',
      message: method === 'applyUpdate' ? '正在重启更新，请保持页面打开…' : '正在检查更新…' });
    try {
      const value = await call(method, lifetime.signal);
      if (closed || run !== generation || id !== request) return;
      set(value);
      if (method === 'applyUpdate') void recover(previous.currentVersion);
    } catch (error) {
      if (!closed && run === generation && id === request) { restartAt = 0; set({ ...previous, actionError: error.message }); }
    } finally {
      if (run === generation) { acting = false; schedule(0); }
    }
  }
  const releaseUrl = value => {
    try {
      const url = new URL(value.releaseUrl);
      return /^https:\/\/github\.com\/TongZi2003\/Notara\/releases\/tag\/v\d+\.\d+\.\d+$/.test(url.href) ? url.href : undefined;
    } catch { return undefined; }
  };
  function Controls({ value }) {
    const native = React.useSyncExternalStore(listener => ctx.sessions.list.subscribe(listener), () => ctx.sessions.list.getSnapshot());
    const busy = Object.values(native.byId).some(row => row.running);
    const url = releaseUrl(value);
    return h(React.Fragment, null,
      h('p', { role: 'status' }, value.message),
      (value.actionError || value.statusError) && h('p', { role: 'alert' }, value.actionError || value.statusError),
      h('div', { className: 'nv-update-actions' },
        value.phase === 'ready' && h('button', { type: 'button', 'data-primary': true, disabled: busy || acting, onClick: () => { void action('applyUpdate'); } }, busy ? '课堂结束后可更新' : '重启并更新'),
        !PENDING_PHASES.includes(value.phase) && value.phase !== 'unsupported' && h('button', { type: 'button', disabled: acting, onClick: () => { void action('checkUpdate'); } }, value.phase === 'error' ? '重新检查' : '检查更新'),
        url && h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, '发布说明')));
  }
  function UpdateNotice() {
    const value = React.useSyncExternalStore(subscribe, snapshot);
    // Closing must notify React even when the server state itself is unchanged.
    const show = React.useSyncExternalStore(subscribe, visible);
    if (!show) return null;
    return h('section', { className: 'nv-update nv-update-toast', role: 'dialog', 'aria-label': 'Notara 更新提示', 'aria-modal': false },
      h('header', null,
        h('span', { className: 'nv-update-mark', 'aria-hidden': true }, h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M12 16V4m-4 4 4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5' }))),
        h('div', null, h('h2', null, value.latestVersion ? `有新版本 ${value.latestVersion}` : '更新检查未完成'), value.currentVersion && h('small', null, `当前版本 ${value.currentVersion}`)),
        h('button', { type: 'button', className: 'nv-update-close', 'aria-label': '关闭更新提示', title: '关闭更新提示', onClick: dismiss },
          h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', 'aria-hidden': true }, h('path', { d: 'm6 6 12 12M18 6 6 18' })))),
      h(Controls, { value }));
  }
  function UpdateSettings() {
    const value = React.useSyncExternalStore(subscribe, snapshot);
    return h('section', { className: 'nv-update nv-update-settings' }, h('h2', null, '更新'),
      h('p', null, value.currentVersion ? `当前版本 ${value.currentVersion}` : 'Notara'),
      value.latestVersion && h('b', null, `有新版本 ${value.latestVersion}`), h(Controls, { value }),
      h('p', { className: 'nv-update-help' }, '每次启动自动检查一次，运行期间每 30 分钟继续检查正式版本。准备更新时可继续学习，点击更新后才会重启。关闭提示不影响检查，也可随时在这里更新。'));
  }
  function install(scope) {
    ctx = scope;
    scope.effect(() => {
      const run = ++generation; closed = false; fetching = false; acting = false; lifetime = new AbortController();
      readDismissed();
      const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
      void refresh();
      const show = () => { if (!document.hidden) { clearTimeout(timer); void refresh(); } };
      const storage = event => { if (event.key === DISMISS_KEY || event.key === null) { readDismissed(); emit(); } };
      document.addEventListener('visibilitychange', show); window.addEventListener('storage', storage);
      return () => { if (generation !== run) return; closed = true; lifetime.abort(); clearTimeout(timer); style.remove(); document.removeEventListener('visibilitychange', show); window.removeEventListener('storage', storage); };
    });
    scope.effect(() => scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'notara.updates', order: 36, label: '更新' }, UpdateSettings)));
    scope.effect(() => scope.slots.inject('shell.overlay', () => scope.slots.register({ name: 'shell.overlay', id: 'notara.update-notice', order: 40 }, UpdateNotice)));
  }
  return { install };
}

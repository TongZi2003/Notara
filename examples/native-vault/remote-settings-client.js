import { REMOTE_SETTINGS_METHODS, REMOTE_SETTINGS_NOTICES } from './remote-settings-contract.js';

export function remoteSettingsDescriptors() {
  const schema = { parse(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object'); return value; } };
  return REMOTE_SETTINGS_METHODS.map(method => ({
    id: `@notara/vault-native#notaraRemote/${method}`, service: 'notaraRemote', namespace: 'notaraRemote', method, invocation: { kind: 'direct' },
    parameters: [{ name: 'input', wire: 'input', source: 'json', codec: { mode: 'strict', typeSymbol: '@notara/vault-native#JsonObject', create: () => schema } }],
    result: { mode: 'strict', typeSymbol: '@notara/vault-native#JsonValue', create: () => schema },
  }));
}

const DEFAULTS = { publicHost: '', username: '', password: '', authtoken: '', ngrokPath: 'ngrok', proxyPort: 57094, ngrokApiPort: 4040 };
const PHASE_LABELS = { disabled: '未启用', starting: '正在启用…', enabled: '已启用', stopping: '正在关闭…', error: '远控未就绪', unsupported: '当前启动器不支持' };

export function installRemoteAccessSettings(ctx, React) {
  ctx.plugin({ inject: ['slots', 'remote.notaraRemote'], apply(scope) {
    const h = React.createElement;
    function RemoteSettings() {
      const [state, setState] = React.useState(null), [form, setForm] = React.useState(DEFAULTS);
      const [dirty, setDirty] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
      const [refreshError, setRefreshError] = React.useState('');
      const mounted = React.useRef(false), loaded = React.useRef(false), dirtyRef = React.useRef(false), busyRef = React.useRef(false), requestId = React.useRef(0), stateRef = React.useRef(null);
      const remote = scope.remote.notaraRemote;
      const message = result => Object.hasOwn(REMOTE_SETTINGS_NOTICES, result?.error?.message) ? REMOTE_SETTINGS_NOTICES[result.error.message] : '远控操作未完成，请稍后重试。';
      const accept = (value, reset = false) => {
        if (stateRef.current && stateRef.current.phase !== value.phase) setError('');
        stateRef.current = value;
        setState(value);
        if (reset || !loaded.current || !dirtyRef.current) { loaded.current = true; dirtyRef.current = false; setForm({ ...DEFAULTS, ...value.config, password: '', authtoken: '' }); setDirty(false); }
      };
      const refresh = async () => {
        const id = ++requestId.current;
        try {
          const result = await remote.status({});
          if (!mounted.current || id !== requestId.current) return;
          if (!result.ok) throw new Error(message(result));
          setRefreshError('');
          accept(result.value);
        } catch (err) { if (mounted.current && id === requestId.current) setRefreshError(err.message ?? '无法读取远控状态。'); }
      };
      React.useEffect(() => {
        mounted.current = true; void refresh();
        const timer = setInterval(() => { if (!document.hidden && !busyRef.current) void refresh(); }, 2000);
        return () => { mounted.current = false; ++requestId.current; clearInterval(timer); };
      }, []);
      const act = async (method, input = {}) => {
        if (busyRef.current) return;
        busyRef.current = true; ++requestId.current; setBusy(true); setError(''); setRefreshError(''); setNotice('');
        try {
          const result = await remote[method](input);
          if (!mounted.current) return;
          if (!result.ok) throw new Error(message(result));
          accept(result.value, method === 'save');
          setNotice(method === 'save' ? '设置已保存，远控仍需手动启用。' : method === 'disable' ? '远控已关闭，本地课堂继续运行。' : '远控已启用。');
        } catch (err) { if (mounted.current) { setError(err.message ?? '远控操作未完成。'); void refresh(); } }
        finally { busyRef.current = false; if (mounted.current) setBusy(false); }
      };
      const changing = busy || ['starting', 'stopping'].includes(state?.phase);
      const active = state?.phase === 'enabled';
      const canDisable = active || state?.canDisable;
      const locked = changing || canDisable || !state?.available;
      const change = (key, value) => { dirtyRef.current = true; setForm(previous => ({ ...previous, [key]: value })); setDirty(true); setNotice(''); setError(''); };
      const field = (key, label, options = {}) => h('label', { className: 'nv-remote-field', key }, h('span', null, label),
        h('input', { name: key, value: form[key], disabled: locked, onChange: event => change(key, event.target.value), ...options }));
      const save = event => {
        event.preventDefault();
        void act('save', { publicHost: form.publicHost.trim().toLowerCase(), username: form.username.trim(), password: form.password, authtoken: form.authtoken,
          ngrokPath: form.ngrokPath.trim() || 'ngrok', proxyPort: Number(form.proxyPort), ngrokApiPort: Number(form.ngrokApiPort) });
      };
      return h('section', { className: 'nv-remote-settings', 'aria-label': '远控设置' },
        h('style', null, '.nv-remote-settings{max-width:680px;padding:16px 0;font-size:14px;line-height:1.65}.nv-remote-settings h2{font-size:18px;margin:0 0 12px}.nv-remote-settings p{margin:8px 0}.nv-remote-status{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;margin:18px 0}.nv-remote-status strong{display:block}.nv-remote-status>div{min-width:0}.nv-remote-status>button{flex-shrink:0;white-space:nowrap}.nv-remote-settings small,.nv-remote-help{color:var(--dsw-alias-label-secondary);font-size:12px}.nv-remote-settings button{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 13px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.nv-remote-settings button:disabled{opacity:.5;cursor:default}.nv-remote-settings button[data-enable]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}.nv-remote-field{display:flex;flex-direction:column;gap:5px;margin:12px 0}.nv-remote-field input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:9px 11px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}.nv-remote-settings details{margin:16px 0}.nv-remote-settings summary{cursor:pointer}.nv-remote-settings [role=alert]{color:#b42318}.nv-remote-url{overflow-wrap:anywhere}.nv-remote-settings a{color:inherit;text-underline-offset:3px}.nv-remote-actions{display:flex;gap:8px;flex-wrap:wrap}'),
        h('h2', null, '远控设置'),
        h('p', null, '按需启用 ngrok，从其他设备通过带密码的 HTTPS 地址访问这台电脑上的 Notara。默认关闭，不影响本地使用。'),
        h('div', { className: 'nv-remote-status' }, h('div', null,
          h('strong', { role: 'status' }, state ? PHASE_LABELS[state.phase] : '正在读取状态…'),
          h('small', null, '关闭 Notara 后远控会停止，下次需重新启用。')),
          canDisable ? h('button', { type: 'button', disabled: changing, onClick: () => {
            const remotePage = !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
            if (!remotePage || window.confirm('关闭远控后，此设备会断开连接。本地课堂继续运行。确定关闭？')) void act('disable');
          } }, active ? '关闭远控' : '重试关闭远控') : h('button', { type: 'button', 'data-enable': true, disabled: changing || !state?.available || !state?.configured || dirty,
            onClick: () => void act('enable') }, changing ? '请稍候…' : '启用远控')),
        state?.url && h('p', { className: 'nv-remote-url' }, '远程地址：', h('a', { href: state.url, target: '_blank', rel: 'noopener noreferrer' }, state.url)),
        state?.code && h('p', { role: 'note' }, REMOTE_SETTINGS_NOTICES[state.code]),
        h('form', { onSubmit: save },
          field('publicHost', 'ngrok 域名', { placeholder: 'your-name.ngrok-free.app', required: true, maxLength: 253, autoComplete: 'off', spellCheck: false }),
          h('p', { className: 'nv-remote-help' }, '填写 ngrok 分配的域名，不含 https:// 和路径。'),
          field('username', '远程访问用户名', { required: true, maxLength: 64, autoComplete: 'off', spellCheck: false }),
          field('password', '远程访问密码', { type: 'password', required: !state?.hasPassword, minLength: 12, maxLength: 128, autoComplete: 'new-password', placeholder: state?.hasPassword ? '已保存；留空保留原密码' : '至少 12 位，不含空格' }),
          field('authtoken', 'ngrok Authtoken', { type: 'password', maxLength: 1000, autoComplete: 'new-password', placeholder: state?.hasAuthtoken ? '已保存；留空保留原令牌' : '可选：留空使用本机已有的 ngrok 配置' }),
          h('p', { className: 'nv-remote-help' }, '密码与令牌仅保存在运行服务的电脑上，页面不会回显。远程密码应只交给你允许使用此实例及其模型账号的人。'),
          h('details', null, h('summary', null, '高级设置'),
            field('ngrokPath', 'ngrok 程序路径', { maxLength: 1000, autoComplete: 'off', spellCheck: false }),
            h('p', { className: 'nv-remote-help' }, '先安装 ngrok；如果它不在 PATH 中，填写 ngrok 可执行文件的完整路径。'),
            field('proxyPort', '代理端口', { type: 'number', min: 1, max: 65535, required: true }),
            field('ngrokApiPort', 'ngrok 管理端口', { type: 'number', min: 1, max: 65535, required: true })),
          canDisable && h('p', { className: 'nv-remote-help' }, '要修改配置，请先关闭远控。'),
          h('div', { className: 'nv-remote-actions' }, h('button', { type: 'submit', disabled: locked || (!dirty && !!state?.configured) }, '保存设置'),
            h('button', { type: 'button', disabled: changing, onClick: () => { setError(''); void refresh(); } }, '刷新状态'))),
        dirty && state?.configured && h('p', { className: 'nv-remote-help' }, '有未保存的修改，请先保存再启用。'),
        (error || refreshError) && h('p', { role: 'alert' }, error || refreshError), notice && h('p', { role: 'status' }, notice));
    }
    scope.effect(() => scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'notara.remote', order: 35, label: '远控设置' }, RemoteSettings)));
  } });
}

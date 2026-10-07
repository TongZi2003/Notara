import { CHATGPT_METHODS, CHATGPT_NOTICES } from './chatgpt-contract.js';

export function chatgptRemoteDescriptors() {
  const schema = { parse(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object'); return value; } };
  return CHATGPT_METHODS.map(method => ({
    id: `@notara/vault-native#notaraChatgpt/${method}`, service: 'notaraChatgpt', namespace: 'notaraChatgpt', method, invocation: { kind: 'direct' },
    parameters: [{ name: 'input', wire: 'input', source: 'json', codec: { mode: 'strict', typeSymbol: '@notara/vault-native#JsonObject', create: () => schema } }],
    result: { mode: 'strict', typeSymbol: '@notara/vault-native#JsonValue', create: () => schema },
  }));
}

export function installChatgptSettings(ctx, React) {
  ctx.plugin({ inject: ['slots', 'remote.notaraChatgpt'], apply(scope) {
    const h = React.createElement;
    function AccountSettings() {
      const [state, setState] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false), [models, setModels] = React.useState({});
      const mounted = React.useRef(true), busyRef = React.useRef(false), latestState = React.useRef(null), statusRequest = React.useRef(0);
      const remote = scope.remote.notaraChatgpt;
      const notice = code => CHATGPT_NOTICES[typeof code === 'string' ? code : code?.message] || '操作未完成，请重试。';
      const refresh = async () => { const request = ++statusRequest.current; const result = await remote.status({}); if (!mounted.current || request !== statusRequest.current) return false; if (result.ok) {
        latestState.current = result.value; setState(result.value);
        setModels(previous => Object.fromEntries(Object.entries(previous).filter(([id, entry]) => result.value.accounts.some(account => account.id === id && account.connected && account.planEnabled && account.authorizationRevision === entry.revision))));
        return true;
      } else { setError(notice(result.error)); return false; } };
      React.useEffect(() => { mounted.current = true; void refresh().catch(() => setError('无法读取登录状态。')); const timer = setInterval(() => { if (!document.hidden) void refresh().catch(() => {}); }, 1500); return () => { mounted.current = false; clearInterval(timer); }; }, []);
      const act = async (method, input = {}) => {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(true); setError('');
        const authorizationRevision = latestState.current?.accounts.find(account => account.id === input.id)?.authorizationRevision;
        // Open on the click stack to avoid popup blockers. The server supplies a loopback start URL.
        const popup = method === 'begin' ? window.open('about:blank', '_blank') : null;
        if (popup) popup.opener = null;
        try {
          const result = await remote[method](input);
          if (!result.ok) throw new Error(notice(result.error));
          if (method === 'begin') {
            const url = new URL(result.value.url);
            if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/start/')) throw new Error('登录地址无效。');
            if (popup) popup.location.replace(url.href); else { await remote.cancel({}); throw new Error('浏览器阻止了登录窗口，请允许弹窗后重试。'); }
          }
          const verified = await refresh();
          if (method === 'models' && mounted.current && verified) {
            const account = latestState.current?.accounts.find(value => value.id === input.id);
            if (account?.connected && account.planEnabled && account.authorizationRevision === authorizationRevision) setModels(previous => ({ ...previous, [input.id]: { revision: authorizationRevision, rows: result.value.models } }));
          }
        } catch (err) { popup?.close(); setError(err.message || '操作未完成，请重试。'); }
        finally { busyRef.current = false; if (mounted.current) setBusy(false); }
      };
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
      return h('section', { className: 'nv-chatgpt-settings', style: { padding: '16px 0', maxWidth: 650 } },
        h('style', null, '.nv-chatgpt-settings{font-size:14px;line-height:1.65}.nv-chatgpt-settings button{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:7px 13px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.nv-chatgpt-settings button:disabled{cursor:default;opacity:.5}.nv-chatgpt-settings button[data-signin]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);padding:10px 18px;font-weight:500}.nv-chatgpt-settings a{color:var(--dsw-alias-label-secondary);text-underline-offset:3px}.nv-chatgpt-settings [role=alert]{color:#b42318}'),
        h('h2', { style: { fontSize: 18 } }, 'ChatGPT 账号'),
        h('p', null, '连接自己的 ChatGPT 账号并授权 Notara 使用订阅额度。可用模型与额度由账号决定。聊天内容将发送给 OpenAI，不会读取你在 ChatGPT 中的历史对话。'),
        h('p', null, '这里显示 OpenAI 为当前账号开放给应用使用的模型，可能与 ChatGPT 网页中的型号不同。新增账号时获取一次，也可以手动刷新。'),
        !local && h('p', { role: 'note' }, '请先在运行 Notara 的电脑上登录。完成后，可以从此远程页面选择该账号的模型。'),
        !state ? h('p', null, '正在读取登录状态…') : state.accounts.map(account => h('div', { key: account.id, style: { padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
          h('strong', null, account.label), h('p', null, account.connected ? (account.planEnabled ? '已连接 · 已允许使用订阅额度' : '已连接 · 尚未允许使用订阅额度') : '已退出'),
          h('button', { disabled: busy || state.pending || !local, onClick: () => void act('begin', { id: account.id }) }, '重新登录'), ' ',
          account.connected && h('button', { disabled: busy, onClick: () => { if (window.confirm(`退出 ${account.label}？正在进行的 ChatGPT 请求将停止。`)) void act('signOut', { id: account.id }); } }, '退出账号'), ' ',
          account.planEnabled && h('button', { disabled: busy, onClick: () => void act('models', { id: account.id }) }, models[account.id] ? '刷新可用模型' : '查看可用模型'),
          models[account.id] && h('p', { 'data-model-catalog': account.id }, models[account.id].rows.length ? `账号返回 ${models[account.id].rows.length} 个可用模型：${models[account.id].rows.map(m => m.name).join('、')}` : '账号目前没有返回可用模型。'))),
        h('p', null, h('button', { 'data-signin': true, disabled: busy || !state || !!state?.pending || !local, onClick: () => void act('begin') }, 'Continue with ChatGPT')),
        state?.pending && h('p', { role: 'status' }, '请在登录窗口完成授权。 ', h('button', { disabled: busy, onClick: () => void act('cancel') }, '取消登录')),
        state?.notice && h('p', { role: 'status' }, notice(state.notice)),
        error && h('p', { role: 'alert' }, error),
        h('p', null, h('a', { href: 'https://chatgpt.com/settings/usage', target: '_blank', rel: 'noopener noreferrer' }, '管理 ChatGPT 用量与授权')));
    }
    scope.effect(() => scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'notara.chatgpt', order: 34, label: 'ChatGPT 账号' }, AccountSettings)));
  } });
}
